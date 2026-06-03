const RESEND_API_KEY = process.env.RESEND_API_KEY;

function emailTemplate(title, rows, footer) {
  const rowsHtml = Object.entries(rows).map(([label, value]) => `
    <tr>
      <td style="padding:8px 16px;font-size:14px;color:#555;width:35%;border-bottom:1px solid #f0f0f0">${label}</td>
      <td style="padding:8px 16px;font-size:14px;color:#1a1a1a;font-weight:500;border-bottom:1px solid #f0f0f0">${value || '—'}</td>
    </tr>`).join('');
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f3;padding:24px">
      <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
        <div style="background:#1E2B5E;padding:20px 24px">
          <div style="color:#fff;font-size:18px;font-weight:600">MRDC Employee Directory</div>
          <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px">${title}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:8px 0">${rowsHtml}</table>
        <div style="padding:16px 24px;background:#f5f5f3;font-size:12px;color:#999;border-top:1px solid #e0e0de">${footer}</div>
      </div>
    </div>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-role, x-user-id, x-user-name');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!RESEND_API_KEY) return res.status(500).json({ error: 'Resend API key not configured' });

  const {
    type, employeeName, jobTitle, department, depot,
    startDate, email, recipientEmail, recipientName, subject
  } = req.body || {};

  if (!recipientEmail) return res.status(400).json({ error: 'Recipient email required' });

  const isDoor = type === 'door_fob';
  const fobType = isDoor ? 'Door FOB' : 'Driver FOB';
  const now = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Halifax',
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const html = emailTemplate(
    `New ${fobType} Request`,
    {
      'Employee':       employeeName  || '—',
      'Job Title':      jobTitle      || '—',
      'Department':     department    || '—',
      'Depot':          depot         || '—',
      'Start Date':     startDate     || '—',
      'Email':          email         || '—',
      'FOB Type':       fobType,
      'Requested':      now,
    },
    `Please arrange to issue a ${fobType} for this new employee. <a href="https://mrdc-htra.com/employees" style="color:#1E2B5E;font-weight:600">Open the app →</a>`
  );

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'MRDC Employee Directory <noreply@mrdc-htra.com>',
        to: [recipientEmail],
        subject: subject || `${fobType} Request — ${employeeName}`,
        html
      })
    });

    const result = await resendRes.json();
    if (!resendRes.ok) return res.status(500).json({ error: result.message || 'Resend error' });
    return res.status(200).json({ success: true, id: result.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
