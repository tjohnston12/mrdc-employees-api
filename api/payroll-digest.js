// Biweekly payroll summary — emails Terri Lee every second Friday (anchored on 2026-06-05)
// a list of all leave requests approved in the preceding two weeks.
// Triggered by a Vercel Cron defined in vercel.json. Manual test: GET /api/payroll-digest?force=1

const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE;
const LEAVE_TABLE = process.env.LEAVE_TABLE || 'Leave Requests';
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE || 'Employees';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// First scheduled Friday; every other Friday after this sends.
const ANCHOR_UTC = Date.UTC(2026, 5, 5); // 2026-06-05 (month is 0-indexed)

async function at(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    console.error('[Airtable error]', JSON.stringify(e));
    throw new Error((e.error && e.error.message) || 'Airtable error');
  }
  return res.json();
}

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY || !to || !to.length) return false;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'MRDC Employee Directory <noreply@mrdc-htra.com>',
      to: Array.isArray(to) ? to : [to],
      subject, html
    })
  }).catch(err => console.error('Email error:', err));
  return true;
}

async function getTerriLeeEmail() {
  try {
    const filter = encodeURIComponent(`{Name}='Terri Lee'`);
    const table = encodeURIComponent(EMPLOYEES_TABLE);
    const data = await at(`${table}?filterByFormula=${filter}&maxRecords=1`);
    const email = data.records && data.records[0] && data.records[0].fields['Email'];
    return email ? [email] : [];
  } catch { return []; }
}

function parseLeaveRows(v) { try { return JSON.parse(v || '[]'); } catch { return []; } }

function leaveRowsSummary(leaveRows) {
  return (leaveRows || [])
    .filter(r => r.days || r.startDate)
    .map(r =>
      `${r.type}${r.days ? ' (' + r.days + ' day(s))' : ''}` +
      `${r.startDate ? ' — ' + r.startDate : ''}` +
      `${r.endDate && r.endDate !== r.startDate ? ' to ' + r.endDate : ''}`
    ).join('<br>') || '—';
}

function fmt(ms) { return new Date(ms).toISOString().split('T')[0]; }

module.exports = async function handler(req, res) {
  // Restrict to Vercel Cron (or anyone holding the secret), if a secret is configured.
  if (CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  }

  const force = req.query && req.query.force === '1';

  // Biweekly gate: only proceed on an "on" Friday in the cycle that starts on the anchor.
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSince = Math.round((todayUTC - ANCHOR_UTC) / 86400000);
  const weeksSince = Math.floor(daysSince / 7);
  const isFriday = now.getUTCDay() === 5;
  const onWeek = daysSince >= 0 && (weeksSince % 2 === 0);

  if (!force && !(isFriday && onWeek)) {
    return res.status(200).json({ skipped: true, reason: 'not a scheduled biweekly Friday', daysSince, weeksSince, isFriday });
  }

  try {
    // Pull approved requests (manager-approved or already filed), then keep those approved in the last 14 days.
    const table = encodeURIComponent(LEAVE_TABLE);
    const filter = encodeURIComponent(`OR({Status}='Manager Approved',{Status}='Filed')`);
    const data = await at(`${table}?filterByFormula=${filter}&pageSize=100`);

    const windowStart = todayUTC - 14 * 86400000;
    const windowEnd = todayUTC;
    const parseDay = (s) => { const d = Date.parse((s || '') + 'T00:00:00Z'); return isNaN(d) ? null : d; };

    // Keep approved requests whose ACTUAL leave dates fall within this pay period.
    // (Approval date is ignored — leave can be approved months ahead of when it's taken.)
    const records = (data.records || [])
      .map(r => {
        const allRows = parseLeaveRows(r.fields['Leave Rows']);
        const rowsInPeriod = allRows.filter(row => {
          const start = parseDay(row.startDate);
          if (start === null) return false;            // can't place undated rows in a period
          const end = parseDay(row.endDate) || start;
          return start <= windowEnd && end >= windowStart;  // overlaps the two-week window
        });
        return {
          employeeName: r.fields['Employee Name'] || '—',
          employeeDepot: r.fields['Employee Depot'] || '—',
          status: r.fields['Status'] || '',
          rowsInPeriod
        };
      })
      .filter(r => r.rowsInPeriod.length > 0)
      .sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));

    const period = `${fmt(windowStart)} to ${fmt(todayUTC)}`;

    let bodyHtml;
    if (!records.length) {
      bodyHtml = `<p style="padding:20px 24px;font-size:14px;color:#555;margin:0">No approved leave falls within this pay period (${period}). Nothing to add to payroll.</p>`;
    } else {
      const rows = records.map(r => `
        <tr>
          <td style="padding:10px 16px;font-size:14px;color:#1a1a1a;font-weight:500;border-bottom:1px solid #f0f0f0;vertical-align:top">${r.employeeName}</td>
          <td style="padding:10px 16px;font-size:13px;color:#555;border-bottom:1px solid #f0f0f0;vertical-align:top">${r.employeeDepot}</td>
          <td style="padding:10px 16px;font-size:13px;color:#555;border-bottom:1px solid #f0f0f0;vertical-align:top">${leaveRowsSummary(r.rowsInPeriod)}</td>
        </tr>`).join('');
      bodyHtml = `
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr>
              <th style="text-align:left;padding:10px 16px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e0e0de">Employee</th>
              <th style="text-align:left;padding:10px 16px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e0e0de">Depot</th>
              <th style="text-align:left;padding:10px 16px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e0e0de">Leave Type(s) &amp; Dates in this period</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:680px;margin:0 auto;background:#f5f5f3;padding:24px">
        <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
          <div style="background:#1E2B5E;padding:20px 24px">
            <div style="color:#fff;font-size:18px;font-weight:600">MRDC Employee Directory</div>
            <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px">Approved Leave — Payroll Summary</div>
          </div>
          <div style="padding:16px 24px 4px;font-size:13px;color:#555">Approved leave occurring in the pay period <strong>${period}</strong> (${records.length} employee${records.length === 1 ? '' : 's'}).</div>
          ${bodyHtml}
          <div style="padding:16px 24px;background:#f5f5f3;font-size:12px;color:#999;border-top:1px solid #e0e0de">Automated biweekly payroll summary from the MRDC Employee Directory. Lists approved leave whose dates fall within the two weeks ending ${fmt(todayUTC)}, regardless of when it was approved.</div>
        </div>
      </div>`;

    const terri = await getTerriLeeEmail();
    const sent = await sendEmail(terri, `Approved Leave — Payroll Summary (${period})`, html);

    return res.status(200).json({ sent: !!sent && terri.length > 0, count: records.length, period, recipients: terri.length });
  } catch (e) {
    console.error('Payroll digest error:', e.message);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
