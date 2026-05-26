// Fetches training/hours data from the Safety App Airtable base
const PAT = process.env.AIRTABLE_PAT;
const SAFETY_BASE = process.env.SAFETY_BASE; // Safety app base ID
const HOURS_TABLE = process.env.SAFETY_HOURS_TABLE || 'Contractor Hours';

async function at(base, path) {
  const res = await fetch(`https://api.airtable.com/v0/${base}/${path}`, {
    headers: { Authorization: `Bearer ${PAT}` }
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return res.json();
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { contractorName } = req.query;
  if (!contractorName || !SAFETY_BASE) {
    return res.status(200).json({ summary: null });
  }

  try {
    const name = decodeURIComponent(contractorName);
    const filter = encodeURIComponent(`{Contractor Name}='${name}'`);
    const table = encodeURIComponent(HOURS_TABLE);
    const data = await at(SAFETY_BASE, `${table}?filterByFormula=${filter}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`);

    const records = data.records;
    if (!records.length) return res.status(200).json({ summary: null });

    const totalHours = records.reduce((s, r) => s + (parseFloat(r.fields['Hours']) || 0), 0);
    const lastSubmission = records[0].fields['Month'] || records[0].fields['Date'] || '—';
    const months = [...new Set(records.map(r => r.fields['Month']).filter(Boolean))];

    return res.status(200).json({
      summary: {
        totalHours: totalHours.toFixed(1),
        lastSubmission,
        totalEntries: records.length,
        months
      }
    });
  } catch(e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
