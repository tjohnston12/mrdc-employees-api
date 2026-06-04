const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.WARNINGS_BASE || process.env.AIRTABLE_BASE;
const WARNINGS_TABLE = process.env.WARNINGS_TABLE || 'tblYLAc0OdVlpPcFx';

async function at(path, options = {}) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
      ...options,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error?.message || `Airtable error ${res.status}`);
    return body;
  } finally {
    clearTimeout(tid);
  }
}

function mapRecord(r) {
  const fields = r.fields || {};
  return {
    id: r.id,
    employeeId:       fields['Employee ID']       || '',
    employeeName:     fields['Employee Name']      || '',
    date:             fields['Date']               || '',
    subject:          fields['Subject']            || '',
    description:      fields['Description']        || '',
    severity:         fields['Severity']           || '',
    issuedBy:         fields['Issued By']          || '',
    acknowledged:     fields['Acknowledged']       || false,
    acknowledgedDate: fields['Acknowledged Date']  || '',
    createdAt:        fields['Created At']         || '',
    fileUrl:  (fields['File'] && fields['File'][0]) ? fields['File'][0].url      : '',
    fileName: (fields['File'] && fields['File'][0]) ? fields['File'][0].filename : ''
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-role, x-user-id, x-user-name');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const table = encodeURIComponent(WARNINGS_TABLE);

  try {
    // ── GET ──────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const employeeId = (req.query || {}).employeeId;
      const all        = (req.query || {}).all;
      const filter = (employeeId && !all)
        ? encodeURIComponent(`{Employee ID}='${employeeId}'`)
        : '';
      const query = filter
        ? `${table}?filterByFormula=${filter}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc&pageSize=100`
        : `${table}?sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc&pageSize=100`;
      const data = await at(query);
      const records = (data.records || []).map(mapRecord);
      return res.status(200).json({ warnings: records });
    }

    // ── POST ─────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = req.body || {};
      const { employeeId, employeeName, date, subject, description, severity, issuedBy, fileUrl, fileName } = body;
      if (!employeeId || !date || !subject)
        return res.status(400).json({ error: 'Employee, date and subject are required' });
      const fields = {
        'Employee ID':   employeeId,
        'Employee Name': employeeName || '',
        'Date':          date,
        'Subject':       subject,
        'Description':   description || '',
        'Issued By':     issuedBy    || '',
        'Acknowledged':  false,
        'Created At':    new Date().toISOString()
      };
      if (severity) fields['Severity'] = severity;
      if (fileUrl)  fields['File'] = [{ url: fileUrl, filename: fileName || 'document' }];
      const data = await at(table, { method: 'POST', body: JSON.stringify({ fields }) });
      return res.status(200).json(mapRecord(data));
    }

    // ── PATCH ────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const body = req.body || {};
      const { id, ...fields } = body;
      if (!id) return res.status(400).json({ error: 'ID required' });
      const af = {};
      if (fields.date             !== undefined) af['Date']             = fields.date;
      if (fields.subject          !== undefined) af['Subject']          = fields.subject;
      if (fields.description      !== undefined) af['Description']      = fields.description;
      if (fields.severity         !== undefined) af['Severity']         = fields.severity || null;
      if (fields.issuedBy         !== undefined) af['Issued By']        = fields.issuedBy;
      if (fields.acknowledged     !== undefined) af['Acknowledged']     = fields.acknowledged;
      if (fields.acknowledgedDate !== undefined) af['Acknowledged Date']= fields.acknowledgedDate;
      if (fields.fileUrl)                        af['File']             = [{ url: fields.fileUrl, filename: fields.fileName || 'document' }];
      const data = await at(`${table}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: af }) });
      return res.status(200).json(mapRecord(data));
    }

    // ── DELETE ───────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID required' });
      await at(`${table}/${id}`, { method: 'DELETE' });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    console.error('[warnings] error:', e.message, e.stack);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
