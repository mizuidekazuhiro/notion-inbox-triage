export async function sendMail({ to, subject, content }, env) {
  const res = await fetch(
    "https://api.mailchannels.net/tx/v1/send",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: to }]
          }
        ],
        from: {
          email: env.MAIL_FROM,
          name: "Notion Inbox Bot"
        },
        subject: subject,
        content: [
          {
            type: "text/html; charset=UTF-8",
            value: content
          }
        ]
      })
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mail send failed: ${text}`);
  }
}