import { chunkToRichText } from "../email/parseEmail";

function notionHeaders(env) {
  return {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };
}

async function postInboxPage(env, properties) {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(env),
    body: JSON.stringify({
      parent: { database_id: env.INBOX_DB_ID },
      properties
    })
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return { res, text, data };
}

function buildRawText({ bodyText, from, msgId, receivedIso }) {
  const metadataLines = [
    "---",
    `from: ${from || "-"}`,
    `received_at: ${receivedIso}`,
    `message-id: ${msgId || "-"}`
  ];

  return [bodyText?.trim() || "", "", ...metadataLines].join("\n");
}

function buildBaseProperties({ subject, rawText, receivedIso, source }) {
  return {
    Name: { title: [{ text: { content: subject } }] },
    Source: { rich_text: [{ text: { content: source } }] },
    Created: { date: { start: receivedIso } },
    Raw: { rich_text: chunkToRichText(rawText, 1800) },
    Processed: { rich_text: [] }
  };
}

export async function createInboxPageInNotion(env, { subject, bodyText, from, msgId }) {
  if (!env.NOTION_TOKEN) {
    throw new Error("NOTION_TOKEN is required to create Notion inbox pages.");
  }
  if (!env.INBOX_DB_ID) {
    throw new Error("INBOX_DB_ID is required to create Notion inbox pages.");
  }

  const source = env.INBOX_SOURCE_VALUE || "Email";
  const receivedIso = new Date().toISOString();
  const rawText = buildRawText({ bodyText, from, msgId, receivedIso });
  const safeSubject = (subject || "(no subject)").slice(0, 200);

  const properties = buildBaseProperties({
    subject: safeSubject,
    rawText,
    receivedIso,
    source
  });

  const result = await postInboxPage(env, properties);
  if (result.res.ok) {
    return result.data;
  }

  if (result.data?.code === "validation_error") {
    const fallbackProperties = {
      ...properties,
      Source: { select: { name: source } }
    };

    const fallbackResult = await postInboxPage(env, fallbackProperties);
    if (fallbackResult.res.ok) {
      return fallbackResult.data;
    }

    throw new Error(`Notion create failed: ${fallbackResult.text || ""}`);
  }

  throw new Error(`Notion create failed: ${result.text || ""}`);
}
