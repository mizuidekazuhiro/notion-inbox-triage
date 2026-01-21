export async function sendMail({ to, subject, content }, env) {
  await sendViaMailChannels({ to, subject, content }, env);
}

async function sendViaMailChannels({ to, subject, content }, env) {
  if (!env.MAILCHANNELS_API_KEY) {
    throw new Error("MAILCHANNELS_API_KEY is required to send mail.");
  }

  const endpoint =
    env.MAILCHANNELS_ENDPOINT || "https://api.mailchannels.net/tx/v1/send";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Api-Key": env.MAILCHANNELS_API_KEY
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
    const hint =
      res.status === 401 || res.status === 403
        ? " Check MAILCHANNELS_API_KEY validity, API scope, and Domain Lockdown TXT record for the MAIL_FROM domain."
        : "";
    throw new Error(`Mail send failed (${res.status}): ${text}${hint}`);
  }
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}
