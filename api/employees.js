const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE || 'Employees';

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
    name: r.fields['Name'] || '',
    jobTitle: r.fields['Job Title'] || '',
    department: r.fields['Department'] || '',
    phone: r.fields['Phone'] || '',
    email: r.fields['Email'] || '',
    photo: (r.fields['Photo'] || [])[0]?.url || '',
    emergencyName: r.fields['Emergency Contact Name'] || '',
    emergencyPhone: r.fields['Emergency Contact Phone'] || '',
    emergencyRelation: r.fields['Emergency Contact Relation'] || '',
    startDate: r.fields['Start Date'] || '',
    notes: r.fields['Notes'] || ''
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const table = encodeURIComponent(EMPLOYEES_TABLE);

  try {
    // GET all or single
    if (req.method === 'GET') {
      const { id, search, department } = req.query;
      if (id) {
        const data = await at(`${table}/${id}`);
        return res.status(200).json(mapRecord(data));
      }
      let filter = '';
      if (search) {
        const s = decodeURIComponent(search);
        filter = encodeURIComponent(`OR(SEARCH(LOWER('${s}'),LOWER({Name})),SEARCH(LOWER('${s}'),LOWER({Job Title})),SEARCH(LOWER('${s}'),LOWER({Department})))`);
      } else if (department) {
        filter = encodeURIComponent(`{Department}='${decodeURIComponent(department)}'`);
      }
      const query = filter
        ? `${table}?filterByFormula=${filter}&sort[0][field]=Name&sort[0][direction]=asc&pageSize=100`
        : `${table}?sort[0][field]=Name&sort[0][direction]=asc&pageSize=100`;
      const data = await at(query);
      return res.status(200).json({ employees: data.records.map(mapRecord) });
    }

    // POST — create
    if (req.method === 'POST') {
      const { name, jobTitle, department, phone, email, emergencyName, emergencyPhone, emergencyRelation, startDate, notes } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Name is required' });
      const data = await at(table, {
        method: 'POST',
        body: JSON.stringify({ fields: {
          'Name': name, 'Job Title': jobTitle||'', 'Department': department||'',
          'Phone': phone||'', 'Email': email||'',
          'Emergency Contact Name': emergencyName||'', 'Emergency Contact Phone': emergencyPhone||'',
          'Emergency Contact Relation': emergencyRelation||'',
          'Start Date': startDate||'', 'Notes': notes||''
        }})
      });
      return res.status(200).json(mapRecord(data));
    }

    // PATCH — update
    if (req.method === 'PATCH') {
      const { id, ...fields } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID required' });
      const airtableFields = {};
      if (fields.name !== undefined) airtableFields['Name'] = fields.name;
      if (fields.jobTitle !== undefined) airtableFields['Job Title'] = fields.jobTitle;
      if (fields.department !== undefined) airtableFields['Department'] = fields.department;
      if (fields.phone !== undefined) airtableFields['Phone'] = fields.phone;
      if (fields.email !== undefined) airtableFields['Email'] = fields.email;
      if (fields.emergencyName !== undefined) airtableFields['Emergency Contact Name'] = fields.emergencyName;
      if (fields.emergencyPhone !== undefined) airtableFields['Emergency Contact Phone'] = fields.emergencyPhone;
      if (fields.emergencyRelation !== undefined) airtableFields['Emergency Contact Relation'] = fields.emergencyRelation;
      if (fields.startDate !== undefined) airtableFields['Start Date'] = fields.startDate;
      if (fields.notes !== undefined) airtableFields['Notes'] = fields.notes;
      const data = await at(`${table}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: airtableFields })
      });
      return res.status(200).json(mapRecord(data));
    }

    // DELETE
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
