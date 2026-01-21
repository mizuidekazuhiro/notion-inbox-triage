import { sendMail } from "../src/mail/sendMail.js";

const requiredVars = ["MAIL_FROM", "MAIL_TO", "MAILCHANNELS_API_KEY"];
const missingVars = requiredVars.filter((name) => !process.env[name]);

if (missingVars.length > 0) {
  throw new Error(`Missing env vars: ${missingVars.join(", ")}`);
}

const env = {
  MAIL_FROM: process.env.MAIL_FROM,
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME,
  MAIL_TO: process.env.MAIL_TO,
  MAILCHANNELS_API_KEY: process.env.MAILCHANNELS_API_KEY,
  MAILCHANNELS_ENDPOINT: process.env.MAILCHANNELS_ENDPOINT
};

const now = new Date().toISOString();

await sendMail(
  {
    to: env.MAIL_TO,
    subject: `Notion Inbox Bot test (${now})`,
    content: `<p>MailChannels Email API test at ${now}</p>`
  },
  env
);

console.log("OK");
