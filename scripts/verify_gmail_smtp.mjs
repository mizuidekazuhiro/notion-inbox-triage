import nodemailer from 'nodemailer';
import { pathToFileURL } from 'node:url';
import { gmailSmtpOptions, verifySmtp } from '../src/utils/gmailSmtp.js';

// AUTH only: no sendMail, recipients, Notion client or Notion writes.
export async function verifyGmail({ env = process.env, createTransport = nodemailer.createTransport } = {}) {
  const transporter = createTransport(gmailSmtpOptions(env));
  try {
    await verifySmtp(transporter);
    return { action: 'smtp_verify_ok', emailSent: false, notionUpdated: false };
  } finally {
    transporter.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyGmail().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
