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
    notes: r.fields['Notes'] || '',
    active: r.fields['Active'] !== false,
    // Driver's license — admin only
    licenseNumber: r.fields['License Number'] || '',
    licenseClass: r.fields['License Class'] || '',
    licenseExpiry: r.fields['License Expiry'] || '',
    licenseProvince: r.fields['License Province'] || '',
    licenseRestrictions: r.fields['License Restrictions'] || '',
    // Abstract
    abstractDate: r.fields['Abstract Date'] || '',
    abstractFile: (r.fields['Abstract File'] || [])[0]?.url || '',
    // Manager & depot
    manager: r.fields['Manager'] || '',
    depot: r.fields['Depot'] || '',
    // Training link
    trainingEmployeeId: r.fields['Training Employee ID'] || ''
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
          'Start Date': startDate||'', 'Notes': notes||'', 'Active': true
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
      if (fields.active !== undefined) airtableFields['Active'] = fields.active;
      if (fields.licenseNumber !== undefined) airtableFields['License Number'] = fields.licenseNumber;
      if (fields.licenseClass !== undefined) airtableFields['License Class'] = fields.licenseClass;
      if (fields.licenseExpiry !== undefined) airtableFields['License Expiry'] = fields.licenseExpiry;
      if (fields.licenseProvince !== undefined) airtableFields['License Province'] = fields.licenseProvince;
      if (fields.licenseRestrictions !== undefined) airtableFields['License Restrictions'] = fields.licenseRestrictions;
      if (fields.abstractDate !== undefined) airtableFields['Abstract Date'] = fields.abstractDate;
      if (fields.manager !== undefined) airtableFields['Manager'] = fields.manager;
      if (fields.depot !== undefined) airtableFields['Depot'] = fields.depot;
      if (fields.trainingEmployeeId !== undefined) airtableFields['Training Employee ID'] = fields.trainingEmployeeId;
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
