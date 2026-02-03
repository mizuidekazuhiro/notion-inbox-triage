async function createUndoSignature(secret, inboxPageId, taskId) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = encoder.encode(`${inboxPageId}|${taskId}`);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return toHex(signature);
}

async function createActionSignature(secret, taskId, to, exp) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = encoder.encode(`${taskId}|${to}|${exp}`);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return toHex(signature);
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export { createUndoSignature, createActionSignature, safeEqual };
