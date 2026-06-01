const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE;
const WARNINGS_TABLE = process.env.WARNINGS_TABLE || 'Warning Letters';

async function at(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', ...(options.headers||{}) }
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return res.json();
}

function mapRecord(r) {
  return {
    id: r.id,
    employeeId: r.fields['Employee ID'] || '',
    employeeName: r.fields['Employee Name'] || '',
    date: r.fields['Date'] || '',
    subject: r.fields['Subject'] || '',
    description: r.fields['Description'] || '',
    severity: r.fields['Severity'] || '',
    issuedBy: r.fields['Issued By'] || '',
    acknowledged: r.fields['Acknowledged'] || false,
    acknowledgedDate: r.fields['Acknowledged Date'] || '',
    createdAt: r.fields['Created At'] || ''
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-role, x-user-id, x-user-name');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const table = encodeURIComponent(WARNINGS_TABLE);
  try {
    if (req.method === 'GET') {
      const { employeeId, all } = req.query;
      const filter = employeeId && !all ? encodeURIComponent(`{Employee ID}='${employeeId}'`) : '';
      const query = filter
        ? `${table}?filterByFormula=${filter}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`
        : `${table}?sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;
      const data = await at(query);
      return res.status(200).json({ warnings: data.records.map(mapRecord) });
    }
    if (req.method === 'POST') {
      const { employeeId, employeeName, date, subject, description, severity, issuedBy } = req.body || {};
      if (!employeeId || !date || !subject) return res.status(400).json({ error: 'Employee, date and subject are required' });
      const data = await at(table, {
        method: 'POST',
        body: JSON.stringify({ fields: {
          'Employee ID': employeeId, 'Employee Name': employeeName||'',
          'Date': date, 'Subject': subject, 'Description': description||'',
          'Severity': severity||null, 'Issued By': issuedBy||'','
          'Acknowledged': false, 'Created At': new Date().toISOString()
        }})
      });
      return res.status(200).json(mapRecord(data));
    }
    if (req.method === 'PATCH') {
      const { id, ...fields } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID required' });
      const af = {};
      if (fields.date !== undefined) af['Date'] = fields.date;
      if (fields.subject !== undefined) af['Subject'] = fields.subject;
      if (fields.description !== undefined) af['Description'] = fields.description;
      if (fields.severity !== undefined) af['Severity'] = fields.severity || null;
      if (fields.issuedBy !== undefined) af['Issued By'] = fields.issuedBy;
      if (fields.acknowledged !== undefined) af['Acknowledged'] = fields.acknowledged;
      if (fields.acknowledgedDate !== undefined) af['Acknowledged Date'] = fields.acknowledgedDate;
      const data = await at(`${table}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: af }) });
      return res.status(200).json(mapRecord(data));
    }
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID required' });
      await at(`${table}/${id}`, { method: 'DELETE' });
      return res.status(200).json({ deleted: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch(e) { return res.status(500).json({ error: e.message || 'Server error' }); }
};
