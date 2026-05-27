const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE;
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE || 'Incidents';

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
    type: r.fields['Type'] || '',
    description: r.fields['Description'] || '',
    severity: r.fields['Severity'] || '',
    location: r.fields['Location'] || '',
    actionTaken: r.fields['Action Taken'] || '',
    followUpRequired: r.fields['Follow-up Required'] || false,
    followUpNotes: r.fields['Follow-up Notes'] || '',
    filedBy: r.fields['Filed By'] || '',
    createdAt: r.fields['Created At'] || ''
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-role, x-user-id, x-user-name');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const table = encodeURIComponent(INCIDENTS_TABLE);

  try {
    if (req.method === 'GET') {
      const { employeeId, all } = req.query;
      let filter = '';
      if (employeeId && !all) {
        filter = encodeURIComponent(`{Employee ID}='${employeeId}'`);
      }
      const query = filter
        ? `${table}?filterByFormula=${filter}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`
        : `${table}?sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;
      const data = await at(query);
      return res.status(200).json({ incidents: data.records.map(mapRecord) });
    }

    if (req.method === 'POST') {
      const { employeeId, employeeName, date, type, description, severity, location, actionTaken, followUpRequired, followUpNotes, filedBy } = req.body || {};
      if (!employeeId || !date || !type || !description) {
        return res.status(400).json({ error: 'Employee, date, type and description are required' });
      }
      const data = await at(table, {
        method: 'POST',
        body: JSON.stringify({ fields: {
          'Employee ID': employeeId,
          'Employee Name': employeeName || '',
          'Date': date,
          'Type': type,
          'Description': description,
          'Severity': severity || '',
          'Location': location || '',
          'Action Taken': actionTaken || '',
          'Follow-up Required': followUpRequired || false,
          'Follow-up Notes': followUpNotes || '',
          'Filed By': filedBy || '',
          'Created At': new Date().toISOString()
        }})
      });
      return res.status(200).json(mapRecord(data));
    }

    if (req.method === 'PATCH') {
      const { id, ...fields } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID required' });
      const airtableFields = {};
      if (fields.date !== undefined) airtableFields['Date'] = fields.date;
      if (fields.type !== undefined) airtableFields['Type'] = fields.type;
      if (fields.description !== undefined) airtableFields['Description'] = fields.description;
      if (fields.severity !== undefined) airtableFields['Severity'] = fields.severity;
      if (fields.location !== undefined) airtableFields['Location'] = fields.location;
      if (fields.actionTaken !== undefined) airtableFields['Action Taken'] = fields.actionTaken;
      if (fields.followUpRequired !== undefined) airtableFields['Follow-up Required'] = fields.followUpRequired;
      if (fields.followUpNotes !== undefined) airtableFields['Follow-up Notes'] = fields.followUpNotes;
      const data = await at(`${table}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: airtableFields }) });
      return res.status(200).json(mapRecord(data));
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID required' });
      await at(`${table}/${id}`, { method: 'DELETE' });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch(e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
