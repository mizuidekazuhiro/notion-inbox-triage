function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractSubject(message) {
  const subject = message.headers.get("subject");
  return subject?.trim() || "(no subject)";
}

export async function extractBodyText(message) {
  const textBody = await message.text();
  if (textBody && textBody.trim()) {
    return textBody.trim();
  }

  const htmlBody = await message.html();
  if (htmlBody && htmlBody.trim()) {
    return stripHtml(htmlBody);
  }

  return "";
}

export function chunkToRichText(text, chunkSize = 1800) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push({ text: { content: text.slice(i, i + chunkSize) } });
  }
  return chunks;
}

export function chunkToRichTextBlocks(text, chunkSize = 1800) {
  return chunkToRichText(text, chunkSize);
}
