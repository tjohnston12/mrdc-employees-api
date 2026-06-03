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
    jobTitle: Array.isArray(r.fields['Job Title']) ? r.fields['Job Title'].join(', ') : (r.fields['Job Title'] || ''),
    department: Array.isArray(r.fields['Department']) ? r.fields['Department'].join(', ') : (r.fields['Department'] || ''),
    cellPhone: r.fields['Cell Phone'] || '',
    officePhone: r.fields['Office Phone'] || '',
    homePhone: r.fields['Home Phone'] || '',
    email: r.fields['Email'] || '',
    photo: (r.fields['Photo'] || [])[0]?.url || '',
    emergencyName: r.fields['Emergency Contact Name'] || '',
    emergencyPhone: r.fields['Emergency Contact Phone'] || '',
    emergencyRelation: r.fields['Emergency Contact Relation'] || '',
    startDate: r.fields['Start Date'] || '',
    endDate: r.fields['End Date'] || '',
    dob: r.fields['Date of Birth'] || '',
    notes: r.fields['Notes'] || '',
    active: r.fields['Active'] !== false,
    // Driver's license — admin only
    licenseNumber: r.fields['License Number'] || '',
    licenseClass: r.fields['License Class'] || '',
    licenseExpiry: r.fields['License Expiry'] || '',
    licenseProvince: r.fields['License Province'] || '',
    licenseRestrictions: r.fields['License Restrictions'] || '',
    licenseEndorsements: r.fields['License Endorsements'] || '',
    licensePhoto: (r.fields['License Photo'] || [])[0]?.url || '',
    licensePhotos: (r.fields['License Photo'] || []).map(f => ({ url: f.url, filename: f.filename })),
    // Abstract
    abstractDate: r.fields['Abstract Date'] || '',
    abstractFile: (r.fields['Abstract File'] || [])[0]?.url || '',
    abstractFiles: (r.fields['Abstract File'] || []).map(f => ({ url: f.url, filename: f.filename })),
    // Manager & depot
    manager: r.fields['Manager'] || '',
    depot: r.fields['Depot'] || '',
    employmentStatus: r.fields['Employment Status'] || '',
    // Training link
    trainingEmployeeId: r.fields['Training Employee ID'] || ''
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-role, x-user-id, x-user-name');
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
          'Cell Phone': '', 'Office Phone': '', 'Home Phone': '', 'Email': email||'', 'Employment Status': null,
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
      if (fields.jobTitle !== undefined) {
        const jt = fields.jobTitle;
        airtableFields['Job Title'] = jt
          ? (Array.isArray(jt) ? jt : jt.split(',').map(t => t.trim()).filter(Boolean))
          : [];
      }
      if (fields.department !== undefined) {
        // Airtable multiple select expects an array
        const deptVal = fields.department;
        airtableFields['Department'] = deptVal
          ? (Array.isArray(deptVal) ? deptVal : deptVal.split(',').map(d => d.trim()).filter(Boolean))
          : [];
      }
      if (fields.cellPhone !== undefined) airtableFields['Cell Phone'] = fields.cellPhone;
      if (fields.officePhone !== undefined) airtableFields['Office Phone'] = fields.officePhone;
      if (fields.homePhone !== undefined) airtableFields['Home Phone'] = fields.homePhone;
      if (fields.email !== undefined) airtableFields['Email'] = fields.email;
      if (fields.emergencyName !== undefined) airtableFields['Emergency Contact Name'] = fields.emergencyName;
      if (fields.emergencyPhone !== undefined) airtableFields['Emergency Contact Phone'] = fields.emergencyPhone;
      if (fields.emergencyRelation !== undefined) airtableFields['Emergency Contact Relation'] = fields.emergencyRelation;
      if (fields.startDate !== undefined) airtableFields['Start Date'] = fields.startDate || null;
      if (fields.endDate !== undefined) airtableFields['End Date'] = fields.endDate || null;
      if (fields.dob !== undefined) airtableFields['Date of Birth'] = fields.dob || null;
      if (fields.notes !== undefined) airtableFields['Notes'] = fields.notes;
      if (fields.active !== undefined) airtableFields['Active'] = fields.active === true || fields.active === 'true';
      if (fields.licenseNumber !== undefined) airtableFields['License Number'] = fields.licenseNumber;
      if (fields.licenseClass !== undefined) airtableFields['License Class'] = fields.licenseClass;
      if (fields.licenseExpiry !== undefined) airtableFields['License Expiry'] = fields.licenseExpiry || null;
      if (fields.licenseProvince !== undefined) airtableFields['License Province'] = fields.licenseProvince;
      if (fields.licenseRestrictions !== undefined) airtableFields['License Restrictions'] = fields.licenseRestrictions;
      if (fields.licenseEndorsements !== undefined) airtableFields['License Endorsements'] = fields.licenseEndorsements;
      if (fields.abstractDate !== undefined) airtableFields['Abstract Date'] = fields.abstractDate || null;
      if (fields.manager !== undefined) airtableFields['Manager'] = fields.manager;
      if (fields.depot !== undefined) airtableFields['Depot'] = fields.depot;
      if (fields.employmentStatus !== undefined) airtableFields['Employment Status'] = fields.employmentStatus || null;
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
