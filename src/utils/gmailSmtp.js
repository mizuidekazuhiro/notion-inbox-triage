// Never include server responses, recipients or credentials in diagnostic output.
export function smtpFailure(error) {
  const auth = error?.code === 'EAUTH' || Number(error?.responseCode) === 535;
  return {
    reason: auth ? 'smtp_auth_failed' : 'smtp_send_failed',
    message: auth
      ? 'smtp_auth_failed: check GMAIL_USER and GMAIL_APP_PASSWORD in Actions secrets'
      : 'smtp_send_failed: check SMTP connectivity and recipient configuration'
  };
}

export function gmailSmtpOptions(env = process.env) {
  const user = String(env.GMAIL_USER || '').trim();
  // Google displays the app password in groups separated by spaces.
  const pass = String(env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  if (!user) throw new Error('GMAIL_USER is required');
  if (!pass) throw new Error('GMAIL_APP_PASSWORD is required');
  return {
    host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    auth: { user, pass }
  };
}

export async function verifySmtp(transporter) {
  try {
    await transporter.verify();
  } catch (error) {
    throw new Error(smtpFailure(error).message);
  }
}
