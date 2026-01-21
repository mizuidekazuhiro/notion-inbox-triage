export function sanitizeSubject(subject) {
  const trimmed = (subject || "").trim();
  return trimmed || "(no subject)";
}

export function stripHtmlToText(html) {
  return (html || "")
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

export function chunkToRichTextBlocks(text, chunkSize = 1800) {
  const chunks = [];
  const safeText = text || "";
  for (let i = 0; i < safeText.length; i += chunkSize) {
    chunks.push({ text: { content: safeText.slice(i, i + chunkSize) } });
  }
  return chunks;
}

export async function readMessageBody(message) {
  try {
    const textBody = await message.text();
    if (textBody && textBody.trim()) {
      return textBody.trim();
    }
  } catch (error) {
    console.error("Failed to read text/plain body", error);
  }

  try {
    const htmlBody = await message.html();
    if (htmlBody && htmlBody.trim()) {
      return stripHtmlToText(htmlBody);
    }
  } catch (error) {
    console.error("Failed to read text/html body", error);
  }

  return "";
}
