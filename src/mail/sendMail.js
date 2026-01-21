export async function sendMail({ to, subject, content }, env) {
  await sendViaMailChannels({ to, subject, content }, env);
}

async function sendViaMailChannels({ to, subject, content }, env) {
  const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
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
        name: env.MAIL_FROM_NAME || "Notion Inbox Bot"
      },
      subject,
      content: [
        {
          type: "text/plain",
          value: stripHtml(content)
        },
        {
          type: "text/html",
          value: content
        }
      ]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mail send failed: ${text}`);
  }
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}
