import nodemailer from "nodemailer";
import { gmailSmtpOptions, smtpFailure } from '../src/utils/gmailSmtp.js';
import { pathToFileURL } from 'node:url';

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

export async function sendDigest({ subject, body, mailTo, gmailUser, gmailPassword, createTransport = nodemailer.createTransport }) {
  const options = gmailSmtpOptions({ GMAIL_USER: gmailUser, GMAIL_APP_PASSWORD: gmailPassword });
  const transporter = createTransport(options);

  try {
    return await transporter.sendMail({
      from: options.auth.user,
      to: mailTo,
      subject,
      text: stripHtml(body),
      html: body
    });
  } finally {
    transporter.close();
  }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('digest_failed: check digest endpoint and mail configuration');
    if (error?.code || error?.responseCode) console.error(smtpFailure(error).message);
    process.exitCode = 1;
  });
}
