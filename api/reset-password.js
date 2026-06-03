const bcrypt = require('bcryptjs');
const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE || 'Employees';
const RESET_SECRET = process.env.RESET_SECRET || 'mrdc-reset-2024';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { secret, username, newPassword } = req.body || {};

  // Require a secret key so random people can't use this
  if (secret !== RESET_SECRET) {
    return res.status(403).json({ error: 'Invalid reset secret' });
  }

  if (!username || !newPassword) {
    return res.status(400).json({ error: 'Username and newPassword required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Look up employee by username
    const filter = encodeURIComponent(`{Username}='${username}'`);
    const table = encodeURIComponent(EMPLOYEES_TABLE);
    const lookupRes = await fetch(`https://api.airtable.com/v0/${BASE}/${table}?filterByFormula=${filter}&maxRecords=1`, {
      headers: { Authorization: `Bearer ${PAT}` }
    });
    if (!lookupRes.ok) throw new Error('Airtable lookup failed');
    const data = await lookupRes.json();

    if (!data.records?.length) {
      return res.status(404).json({ error: 'Username not found' });
    }

    const recordId = data.records[0].id;
    const name = data.records[0].fields['Name'] || username;

    // Generate new bcrypt hash
    const hash = await bcrypt.hash(newPassword, 12);

    // Update Airtable
    const updateRes = await fetch(`https://api.airtable.com/v0/${BASE}/${table}/${recordId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: { 'Password Hash': hash } })
    });

    if (!updateRes.ok) throw new Error('Airtable update failed');

    return res.status(200).json({ success: true, message: `Password updated for ${name}` });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
