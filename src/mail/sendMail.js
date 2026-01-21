export async function sendMail({ to, subject, content }, env) {
  const provider = (env.MAIL_PROVIDER || "mailchannels").toLowerCase();

  if (provider === "gmail") {
    await sendViaGmail({ to, subject, content }, env);
    return;
  }

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

async function sendViaGmail({ to, subject, content }, env) {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Missing Gmail OAuth environment variables");
  }

  const accessToken = await fetchGmailAccessToken(env);
  const fromName = env.MAIL_FROM_NAME || "Notion Inbox Bot";
  const fromEmail = env.MAIL_FROM || env.GMAIL_SENDER || "me";
  const raw = buildRawEmail({
    to,
    subject,
    fromName,
    fromEmail,
    html: content,
    text: stripHtml(content)
  });

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail send failed: ${text}`);
  }
}

async function fetchGmailAccessToken(env) {
  const params = new URLSearchParams({
    client_id: env.GMAIL_CLIENT_ID,
    client_secret: env.GMAIL_CLIENT_SECRET,
    refresh_token: env.GMAIL_REFRESH_TOKEN,
    grant_type: "refresh_token"
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch Gmail access token: ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

function buildRawEmail({ to, subject, fromName, fromEmail, text, html }) {
  const boundary = `boundary_${Date.now()}`;
  const encodedSubject = encodeHeader(subject);
  const lines = [
    `From: ${encodeHeader(fromName)} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    toBase64(text),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    toBase64(html),
    "",
    `--${boundary}--`,
    ""
  ];

  return toBase64Url(lines.join("\r\n"));
}

function encodeHeader(value) {
  if (!/[^\x00-\x7F]/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${toBase64(value)}?=`;
}

function toBase64(input) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function toBase64Url(input) {
  return toBase64(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}
