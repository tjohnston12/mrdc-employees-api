const RESEND_API_KEY = process.env.RESEND_API_KEY;
const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE;
const ADMINS_TABLE = process.env.ADMINS_TABLE || 'Admins';

async function getAdminEmails() {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(ADMINS_TABLE)}?pageSize=100`, {
    headers: { Authorization: `Bearer ${PAT}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.records
    .filter(r => ['Admin', 'Viewer'].includes(r.fields['Role']) && r.fields['Email'])
    .map(r => r.fields['Email']);
}

function emailTemplate(title, rows, footer) {
  const rowsHtml = Object.entries(rows).map(([label, value]) => `
    <tr>
      <td style="padding:8px 16px;font-size:14px;color:#555;width:35%;border-bottom:1px solid #f0f0f0">${label}</td>
      <td style="padding:8px 16px;font-size:14px;color:#1a1a1a;font-weight:500;border-bottom:1px solid #f0f0f0">${value}</td>
    </tr>`).join('');
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f3;padding:24px">
      <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
        <div style="background:#185FA5;padding:20px 24px">
          <div style="color:#fff;font-size:18px;font-weight:600">MRDC Safety App</div>
          <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px">${title}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:8px 0">${rowsHtml}</table>
        <div style="padding:16px 24px;background:#f5f5f3;font-size:12px;color:#999;border-top:1px solid #e0e0de">${footer}</div>
      </div>
    </div>`;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const adminEmails = await getAdminEmails();
    if (!adminEmails.length) {
      return res.status(200).json({ skipped: true, reason: 'No admin emails found' });
    }

    const { type, contractorName, company, month, zone, workType, supervisor, hours, slotLabel, filename } = req.body || {};

    let subject, html;
    const now = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Halifax', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    if (type === 'hours') {
      subject = `Hours Submission — ${contractorName} — ${month}`;
      html = emailTemplate('New Hours Submission', {
        'Contractor': contractorName || '—',
        'Company': company || '—',
        'Month': month || '—',
        'Zone(s)': zone || '—',
        'Work Type': workType || '—',
        'Supervisor': supervisor || '—',
        'Hours': (hours || '—') + ' hrs',
        'Submitted': now
      }, 'Automated notification from the MRDC Safety App.');
    } else {
      subject = `Document Upload — ${contractorName} — ${slotLabel}`;
      html = emailTemplate('New Document Upload', {
        'Contractor': contractorName || '—',
        'Company': company || '—',
        'Document': slotLabel || '—',
        'File': filename || '—',
        'Uploaded': now
      }, 'Automated notification from the MRDC Safety App.');
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'MRDC Safety App <safety@mrdc-htra.com>',
        to: adminEmails,
        subject,
        html
      })
    });

    const result = await resendRes.json();
    console.log('Resend response:', JSON.stringify(result));

    if (!resendRes.ok) {
      return res.status(500).json({ error: result.message || 'Resend error', detail: result });
    }

    return res.status(200).json({ success: true, sent_to: adminEmails.length, id: result.id });
  } catch (e) {
    console.error('Notify error:', e.message);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
