export async function sendMail({ to, subject, content }) {
  const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: {
        email: "no-reply@your-worker.workers.dev",
        name: "Inbox Judge Bot"
      },
      subject,
      content: [
        {
          type: "text/plain",
          value: content
        }
      ]
    })
  });

  if (!res.ok) {
    throw new Error("Mail send failed");
  }
}
