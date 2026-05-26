const { createHash } = require('crypto');
const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE;
const ADMINS_TABLE = process.env.ADMINS_TABLE || 'Admins';
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE || 'Employees';

function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

async function at(path) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
    headers: { Authorization: `Bearer ${PAT}` }
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return res.json();
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  try {
    const filter = encodeURIComponent(`{Username}='${username}'`);
    const data = await at(`${encodeURIComponent(ADMINS_TABLE)}?filterByFormula=${filter}&maxRecords=1`);
    if (!data.records?.length) return res.status(401).json({ error: 'Invalid username or password' });

    const rec = data.records[0];
    if (sha256(password) !== (rec.fields['Password Hash'] || ''))
      return res.status(401).json({ error: 'Invalid username or password' });

    const name = rec.fields['Name'] || username;
    const role = rec.fields['Role'] || 'Employee';
    const email = rec.fields['Email'] || '';

    // Look up employee record
    let employeeId = null;
    let department = '';
    let jobTitle = '';
    let photo = '';
    try {
      const empFilter = encodeURIComponent(`{Email}='${email}'`);
      const empData = await at(`${encodeURIComponent(EMPLOYEES_TABLE)}?filterByFormula=${empFilter}&maxRecords=1`);
      if (empData.records?.length) {
        employeeId = empData.records[0].id;
        department = empData.records[0].fields['Department'] || '';
        jobTitle = empData.records[0].fields['Job Title'] || '';
        const photos = empData.records[0].fields['Photo'] || [];
        photo = photos[0]?.url || '';
      }
    } catch(e) { /* silently fail */ }

    return res.status(200).json({
      token: require('crypto').randomBytes(32).toString('hex'),
      expiresAt: Date.now() + 30 * 60 * 1000,
      user: { name, username, role, email, employeeId, department, jobTitle, photo }
    });
  } catch(e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
