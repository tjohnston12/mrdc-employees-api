const bcrypt = require('bcryptjs');
const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE || 'Employees';

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
    const data = await at(`${encodeURIComponent(EMPLOYEES_TABLE)}?filterByFormula=${filter}&maxRecords=1`);

    if (!data.records?.length) return res.status(401).json({ error: 'Invalid username or password' });

    const rec = data.records[0];

    // Check active
    if (rec.fields['Active'] === false) {
      return res.status(401).json({ error: 'Your account has been deactivated. Please contact your administrator.' });
    }

    const storedHash = rec.fields['Password Hash'] || '';

    // Support both bcrypt and SHA-256 hashes
    let passwordValid = false;
    if (storedHash.startsWith('$2')) {
      // bcrypt hash
      passwordValid = await bcrypt.compare(password, storedHash);
    } else {
      // SHA-256 hash (legacy)
      const { createHash } = require('crypto');
      passwordValid = createHash('sha256').update(password).digest('hex') === storedHash;
    }

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const name = rec.fields['Name'] || username;
    const role = rec.fields['Role'] || 'Employee';
    const email = rec.fields['Email'] || '';
    const department = rec.fields['Department'] || '';
    const jobTitle = rec.fields['Job Title'] || '';
    const photos = rec.fields['Photo'] || [];
    const photo = photos[0]?.url || '';

    return res.status(200).json({
      token: require('crypto').randomBytes(32).toString('hex'),
      expiresAt: Date.now() + 30 * 60 * 1000,
      user: {
        name,
        username,
        role,
        email,
        employeeId: rec.id,
        department,
        jobTitle,
        photo
      }
    });
  } catch(e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
