const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE || 'Employees';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

async function at(path) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
    headers: { Authorization: `Bearer ${PAT}` }
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return res.json();
}

async function getManagerEmail(managerName) {
  if (!managerName) return null;
  try {
    const filter = encodeURIComponent(`{Name}='${managerName}'`);
    const data = await at(`${encodeURIComponent(EMPLOYEES_TABLE)}?filterByFormula=${filter}&maxRecords=1`);
    return data.records?.[0]?.fields?.['Email'] || null;
  } catch(e) { return null; }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Allow GET for cron, POST for manual trigger
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get today's date in Atlantic time (Halifax)
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Halifax' }));
    const todayMonth = today.getMonth() + 1; // 1-12
    const todayDay = today.getDate();

    // Fetch all active employees with DOB and manager
    const data = await at(
      `${encodeURIComponent(EMPLOYEES_TABLE)}?fields[]=Name&fields[]=Date of Birth&fields[]=Manager&fields[]=Job Title&fields[]=Active&pageSize=100`
    );

    const birthdays = [];
    for (const r of data.records || []) {
      const dob = r.fields['Date of Birth'];
      const active = r.fields['Active'] !== false;
      const manager = r.fields['Manager'] || '';
      if (!dob || !active || !manager) continue;

      // Parse DOB — Airtable returns YYYY-MM-DD
      const [year, month, day] = dob.split('-').map(Number);
      if (month === todayMonth && day === todayDay) {
        birthdays.push({
          name: r.fields['Name'] || '',
          jobTitle: r.fields['Job Title'] || '',
          manager,
          dob,
          age: today.getFullYear() - year
        });
      }
    }

    if (birthdays.length === 0) {
      return res.status(200).json({ message: 'No birthdays today', count: 0 });
    }

    // Send email to each manager
    const sent = [];
    for (const emp of birthdays) {
      const managerEmail = await getManagerEmail(emp.manager);
      if (!managerEmail) {
        sent.push({ employee: emp.name, status: 'no manager email found' });
        continue;
      }

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f3;padding:24px">
          <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
            <div style="background:#185FA5;padding:20px 24px">
              <div style="color:#fff;font-size:18px;font-weight:600">MRDC Employee Directory</div>
              <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px">🎂 Birthday Reminder</div>
            </div>
            <div style="padding:24px">
              <p style="font-size:16px;color:#1a1a1a;margin:0 0 16px">Hi ${emp.manager},</p>
              <p style="font-size:15px;color:#1a1a1a;margin:0 0 16px">
                Just a reminder that today is <strong>${emp.name}</strong>'s birthday! 🎉
              </p>
              <div style="background:#EEF0F8;border-radius:8px;padding:16px;margin:0 0 16px">
                <div style="font-size:13px;color:#555;margin-bottom:4px">Employee</div>
                <div style="font-size:16px;font-weight:600;color:#1a1a1a">${emp.name}</div>
                ${emp.jobTitle ? `<div style="font-size:13px;color:#555;margin-top:4px">${emp.jobTitle}</div>` : ''}
              </div>
              <p style="font-size:14px;color:#6B6B6B;margin:0">
                Take a moment to wish ${emp.name.split(' ')[0]} a happy birthday!
              </p>
            </div>
            <div style="padding:16px 24px;background:#f5f5f3;font-size:12px;color:#999;border-top:1px solid #e0e0de">
              Automated birthday reminder from the MRDC Employee Directory.
            </div>
          </div>
        </div>`;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'MRDC Employee Directory <safety@mrdc-htra.com>',
          to: [managerEmail],
          subject: `🎂 Birthday Reminder — ${emp.name}`,
          html
        })
      });

      const result = await emailRes.json();
      sent.push({
        employee: emp.name,
        manager: emp.manager,
        managerEmail,
        status: emailRes.ok ? 'sent' : 'failed',
        error: emailRes.ok ? undefined : result.message
      });
    }

    return res.status(200).json({ birthdays: birthdays.length, results: sent });
  } catch(e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
