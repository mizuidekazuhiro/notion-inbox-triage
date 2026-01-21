import nodemailer from "nodemailer";

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

async function fetchDigest(digestUrl) {
  const res = await fetch(digestUrl);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch digest: ${res.status} ${text}`);
  }
  return res.json();
}

async function sendDigest({ subject, body, mailTo, gmailUser, gmailPassword }) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: gmailUser,
      pass: gmailPassword
    }
  });

  const info = await transporter.sendMail({
    from: gmailUser,
    to: mailTo,
    subject,
    text: stripHtml(body),
    html: body
  });

  return info;
}

async function main() {
  const digestUrl = requireEnv("DIGEST_URL");
  const gmailUser = requireEnv("GMAIL_USER");
  const gmailPassword = requireEnv("GMAIL_APP_PASSWORD");
  const mailTo = requireEnv("MAIL_TO");

  const digest = await fetchDigest(digestUrl);
  if (!digest?.subject || !digest?.body) {
    throw new Error("Digest response missing subject/body");
  }

  const info = await sendDigest({
    subject: digest.subject,
    body: digest.body,
    mailTo,
    gmailUser,
    gmailPassword
  });

  console.log(`Sent digest: ${digest.subject}`);
  console.log(`Message ID: ${info.messageId}`);
  if (info.response) {
    console.log(`SMTP response: ${info.response}`);
  }
}

main().catch((error) => {
  console.error("Failed to send digest via SMTP.");
  console.error(error);
  process.exit(1);
});
