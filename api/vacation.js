const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE;
const LEAVE_TABLE = process.env.LEAVE_TABLE || 'Leave Requests';
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE || 'Employees';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

async function at(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) { const e = await res.json(); console.error('[Airtable error]', JSON.stringify(e)); throw new Error(e.error?.message || JSON.stringify(e) || 'Airtable error'); }
  return res.json();
}

function mapRecord(r) {
  return {
    id: r.id,
    employeeId:       r.fields['Employee ID']       || '',
    employeeName:     r.fields['Employee Name']     || '',
    employeeDepot:    r.fields['Employee Depot']    || '',
    employeeManager:  r.fields['Employee Manager']  || '',
    dateOfRequest:    r.fields['Date of Request']   || '',
    location:         r.fields['Location']          || '',
    leaveRows: (() => { try { return JSON.parse(r.fields['Leave Rows'] || '[]'); } catch { return []; } })(),
    doctorCertificate: r.fields['Doctor Certificate'] || '',
    details:          r.fields['Details']           || '',
    status:           r.fields['Status']            || 'Pending',
    filedBy:          r.fields['Filed By']           || '',
    filedDate:        r.fields['Filed Date']         || '',
    // Stage 1 — Manager
    managerApprovedBy:    r.fields['Manager Approved By']   || '',
    managerApprovedDate:  r.fields['Manager Approved Date'] || '',
    managerNotes:         r.fields['Manager Notes']         || '',
    // Stage 2 — Admin
    adminApprovedBy:   r.fields['Admin Approved By']  || '',
    adminApprovedDate: r.fields['Admin Approved Date'] || '',
    adminNotes:        r.fields['Admin Notes']         || '',
    submittedAt:       r.fields['Submitted At']        || ''
  };
}

// ── Email helpers ──────────────────────────────────────────────

function emailTemplate(title, rows, footer) {
  const rowsHtml = Object.entries(rows).map(([label, value]) => `
    <tr>
      <td style="padding:8px 16px;font-size:14px;color:#555;width:35%;border-bottom:1px solid #f0f0f0">${label}</td>
      <td style="padding:8px 16px;font-size:14px;color:#1a1a1a;font-weight:500;border-bottom:1px solid #f0f0f0">${value || '—'}</td>
    </tr>`).join('');
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f3;padding:24px">
      <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
        <div style="background:#1E2B5E;padding:20px 24px">
          <div style="color:#fff;font-size:18px;font-weight:600">MRDC Employee Directory</div>
          <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px">${title}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:8px 0">${rowsHtml}</table>
        <div style="padding:16px 24px;background:#f5f5f3;font-size:12px;color:#999;border-top:1px solid #e0e0de">${footer}</div>
      </div>
    </div>`;
}

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY || !to?.length) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'MRDC Employee Directory <noreply@mrdc-htra.com>',
      to: Array.isArray(to) ? to : [to],
      subject, html
    })
  }).catch(err => console.error('Email error:', err));
}

// Look up employees by role/depot to find manager or admin emails
async function getEmployeeEmails({ role, depot, managerName }) {
  try {
    let filter = '';
    if (managerName) {
      // Find the specific manager by name to get their email
      filter = encodeURIComponent(`AND({Name}='${managerName}',{Active}=TRUE())`);
    } else if (role && depot) {
      filter = encodeURIComponent(`AND(FIND('${role}',{Role}),{Depot}='${depot}',{Active}=TRUE())`);
    } else if (role) {
      filter = encodeURIComponent(`AND(FIND('${role}',{Role}),{Active}=TRUE())`);
    }
    const table = encodeURIComponent(EMPLOYEES_TABLE);
    const data = await at(`${table}?filterByFormula=${filter}&pageSize=50`);
    return data.records
      .filter(r => r.fields['Email'])
      .map(r => r.fields['Email']);
  } catch { return []; }
}

function leaveRowsSummary(leaveRows) {
  return (leaveRows || [])
    .filter(r => r.days || r.startDate)
    .map(r =>
      `${r.type}${r.days ? ' (' + r.days + ' day(s))' : ''}` +
      `${r.startDate ? ' — ' + r.startDate : ''}` +
      `${r.endDate && r.endDate !== r.startDate ? ' to ' + r.endDate : ''}`
    ).join('<br>') || '—';
}

async function getTerriLeeEmail() {
  try {
    const filter = encodeURIComponent(`{Name}='Terri Lee'`);
    const table = encodeURIComponent(EMPLOYEES_TABLE);
    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${table}?filterByFormula=${filter}&maxRecords=1`, {
      headers: { Authorization: `Bearer ${PAT}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const email = data.records?.[0]?.fields?.['Email'];
    return email ? [email] : [];
  } catch { return []; }
}

// ── Main handler ───────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-role, x-user-id, x-user-name');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const table = encodeURIComponent(LEAVE_TABLE);

  try {

    // ── GET ────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { employeeId, all, depot } = req.query;

      let filter = '';
      if (employeeId && !all) {
        // Employee: own requests only
        filter = encodeURIComponent(`{Employee ID}='${employeeId}'`);
      } else if (all && depot) {
        // Manager: all requests from their depot
        filter = encodeURIComponent(`{Employee Depot}='${depot}'`);
      }
      // Admin (all=1, no depot): no filter → see everything

      const query = filter
        ? `${table}?filterByFormula=${filter}&sort[0][field]=Submitted%20At&sort[0][direction]=desc&pageSize=100`
        : `${table}?sort[0][field]=Submitted%20At&sort[0][direction]=desc&pageSize=100`;

      const data = await at(query);
      return res.status(200).json({ requests: data.records.map(mapRecord) });
    }

    // ── POST — new submission ──────────────────────────────────
    if (req.method === 'POST') {
      const {
        employeeId, employeeName, employeeDepot, employeeManager,
        dateOfRequest, location, leaveRows, doctorCertificate, details
      } = req.body || {};

      if (!employeeId || !dateOfRequest || !leaveRows?.length) {
        return res.status(400).json({ error: 'Employee, date, and at least one leave type are required' });
      }

      const data = await at(table, {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            'Employee ID':      employeeId,
            'Employee Name':    employeeName    || '',
            'Employee Depot':   employeeDepot   || '',
            'Employee Manager': employeeManager || '',
            'Date of Request':  dateOfRequest,
            'Location':         location        || '',
            'Leave Rows':       JSON.stringify(leaveRows),
            'Doctor Certificate': doctorCertificate || '',
            'Details':          details || '',
            'Status':           'Pending',
            'Submitted At':     new Date().toISOString()
          }
        })
      });

      const record = mapRecord(data);

      // Stage 1: Email the employee's manager
      if (employeeManager) {
        const managerEmails = await getEmployeeEmails({ managerName: employeeManager });
        if (managerEmails.length) {
          const html = emailTemplate('New Leave Request — Awaiting Your Approval', {
            'Employee':        employeeName  || '—',
            'Depot':           employeeDepot || '—',
            'Date of Request': dateOfRequest,
            'Location':        location      || '—',
            'Leave Type(s)':   leaveRowsSummary(leaveRows),
            ...(doctorCertificate ? { "Doctor's Certificate": doctorCertificate } : {}),
            ...(details            ? { 'Details': details }                          : {}),
            'Status':          'Pending — awaiting your approval'
          }, 'Please log in to review this request: <a href="https://mrdc-htra.com/employees" style="color:#1E2B5E;font-weight:600">mrdc-htra.com/employees</a>');
          await sendEmail(managerEmails, `Leave Request — ${employeeName} — Awaiting Your Approval`, html);
        }
      } else {
        // No manager assigned — go straight to admins
        const adminEmails = await getEmployeeEmails({ role: 'Admin' });
        if (adminEmails.length) {
          const html = emailTemplate('New Leave Request (No Manager Assigned)', {
            'Employee':        employeeName  || '—',
            'Depot':           employeeDepot || '—',
            'Date of Request': dateOfRequest,
            'Location':        location      || '—',
            'Leave Type(s)':   leaveRowsSummary(leaveRows),
            'Status':          'Pending — no manager assigned, sent directly to admin'
          }, 'Automated notification from the MRDC Employee Directory. <a href="https://mrdc-htra.com/employees" style="color:#1E2B5E;font-weight:600">Open the app &rarr;</a>');
          await sendEmail(adminEmails, `Leave Request — ${employeeName} — No Manager Assigned`, html);
        }
      }

      return res.status(200).json(record);
    }

    // ── PATCH — approve / deny / update ───────────────────────
    if (req.method === 'PATCH') {
      const { id, action, ...fields } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID required' });

      const af = {};

      // Field updates
      if (fields.location          !== undefined) af['Location']          = fields.location;
      if (fields.leaveRows         !== undefined) af['Leave Rows']        = JSON.stringify(fields.leaveRows);
      if (fields.doctorCertificate !== undefined) af['Doctor Certificate']= fields.doctorCertificate;
      if (fields.details           !== undefined) af['Details']           = fields.details;

      // Stage 1: Manager approval
      if (action === 'manager-approve') {
        af['Status']               = 'Manager Approved';
        af['Manager Approved By']  = fields.managerApprovedBy  || '';
        af['Manager Approved Date']= fields.managerApprovedDate || new Date().toISOString().split('T')[0];
        af['Manager Notes']        = fields.managerNotes        || '';
      }

      // Stage 1: Manager deny
      if (action === 'manager-deny') {
        af['Status']               = 'Denied';
        af['Manager Approved By']  = fields.managerApprovedBy  || '';
        af['Manager Approved Date']= fields.managerApprovedDate || new Date().toISOString().split('T')[0];
        af['Manager Notes']        = fields.managerNotes        || '';
      }

      // Stage 2: Terri Lee files the request
      if (action === 'file') {
        af['Status']      = 'Filed';
        af['Filed By']    = fields.filedBy    || '';
        af['Filed Date']  = fields.filedDate  || new Date().toISOString().split('T')[0];
      }

      // Generic status update (fallback)
      if (!action && fields.status !== undefined) af['Status'] = fields.status;

      const data = await at(`${table}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: af })
      });
      const record = mapRecord(data);

      // ── Post-approval emails ───────────────────────────────
      const summary = leaveRowsSummary(record.leaveRows);

      if (action === 'manager-approve') {
        // Notify Terri Lee to file the request
        const terriEmail = await getTerriLeeEmail();
        if (terriEmail.length) {
          const html = emailTemplate('Leave Request — Approved by Manager, Please File', {
            'Employee':            record.employeeName     || '—',
            'Depot':               record.employeeDepot    || '—',
            'Date of Request':     record.dateOfRequest,
            'Location':            record.location         || '—',
            'Leave Type(s)':       summary,
            'Manager Approved By': record.managerApprovedBy,
            'Manager Notes':       record.managerNotes     || '—',
            'Status':              'Manager Approved — please log in to acknowledge and file'
          }, 'Please log in to the MRDC Employee Directory to acknowledge and file this leave request. <a href="https://mrdc-htra.com/employees" style="color:#1E2B5E;font-weight:600">Open the app &rarr;</a>');
          await sendEmail(terriEmail, `Leave Request — ${record.employeeName} — Ready to File`, html);
        }
      }

      if (action === 'manager-deny') {
        // Notify admins that manager denied (FYI)
        const adminEmails = await getEmployeeEmails({ role: 'Admin' });
        if (adminEmails.length) {
          const html = emailTemplate('Leave Request — Denied by Manager', {
            'Employee':        record.employeeName  || '—',
            'Depot':           record.employeeDepot || '—',
            'Date of Request': record.dateOfRequest,
            'Manager':         record.managerApprovedBy,
            'Manager Notes':   record.managerNotes  || '—',
            'Status':          'Denied'
          }, 'Automated notification from the MRDC Employee Directory. <a href="https://mrdc-htra.com/employees" style="color:#1E2B5E;font-weight:600">Open the app &rarr;</a>');
          await sendEmail(adminEmails, `Leave Request — ${record.employeeName} — Denied by Manager`, html);
        }
      }

      if (action === 'file') {
        // Notify manager that the request has been filed
        if (record.employeeManager) {
          const managerEmails = await getEmployeeEmails({ managerName: record.employeeManager });
          if (managerEmails.length) {
            const html = emailTemplate('Leave Request — Filed by Administration', {
              'Employee':        record.employeeName  || '—',
              'Date of Request': record.dateOfRequest,
              'Leave Type(s)':   summary,
              'Filed By':        record.filedBy       || '—',
              'Status':          'Filed'
            }, 'Automated notification from the MRDC Employee Directory. <a href="https://mrdc-htra.com/employees" style="color:#1E2B5E;font-weight:600">Open the app &rarr;</a>');
            await sendEmail(managerEmails, `Leave Request — ${record.employeeName} — Filed`, html);
          }
        }
      }

      return res.status(200).json(record);
    }

    // ── DELETE ─────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID required' });
      await at(`${table}/${id}`, { method: 'DELETE' });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    console.error('Vacation handler error:', e.message);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
