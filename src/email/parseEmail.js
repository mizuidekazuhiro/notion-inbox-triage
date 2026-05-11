export function sanitizeSubject(subject) {
  const trimmed = (subject || "").trim();
  if (!trimmed) {
    return "(no subject)";
  }

  const decoded = decodeMimeEncodedWords(trimmed);
  return decoded.trim() || "(no subject)";
}

const MIME_ENCODED_WORD_PATTERN = /=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g;

function decodeMimeEncodedWords(input) {
  let hasMatch = false;
  let failed = false;

  const normalizedInput = input.replace(/(=\?[^?\s]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?[^?\s]+\?[bBqQ]\?[^?]*\?=)/g, "$1");

  const decoded = normalizedInput.replace(MIME_ENCODED_WORD_PATTERN, (match, charset, encoding, text) => {
    hasMatch = true;
    const word = decodeMimeWord(charset, encoding, text);
    if (word == null) {
      failed = true;
      return match;
    }
    return word;
  });

  if (!hasMatch || failed) {
    return input;
  }

  return decoded;
}

function decodeMimeWord(charset, encoding, encodedText) {
  try {
    const normalizedCharset = normalizeCharset(charset);
    if (!normalizedCharset) {
      return null;
    }

    const bytes =
      encoding.toUpperCase() === "B"
        ? decodeBase64ToBytes(encodedText)
        : decodeQuotedPrintableWordToBytes(encodedText);

    return new TextDecoder(normalizedCharset).decode(bytes);
  } catch {
    return null;
  }
}

function normalizeCharset(charset) {
  const normalized = String(charset || "").trim().toLowerCase();
  if (normalized === "utf-8" || normalized === "utf8") {
    return "utf-8";
  }
  if (normalized === "iso-2022-jp") {
    return "iso-2022-jp";
  }
  return null;
}

function decodeBase64ToBytes(value) {
  const cleaned = String(value || "").replace(/\s+/g, "");
  const binary = atob(cleaned);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeQuotedPrintableWordToBytes(value) {
  const source = String(value || "").replace(/_/g, " ");
  const bytes = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "=") {
      const hex = source.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) {
        throw new Error("Invalid quoted-printable sequence");
      }
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0));
    }
  }
  return Uint8Array.from(bytes);
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
