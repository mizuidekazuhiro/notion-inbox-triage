import { chunkToRichTextBlocks } from "../email/parseEmail";

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

function buildBaseProperties({ subject, rawText, receivedIso, source }) {
  return {
    Name: { title: [{ text: { content: subject } }] },
    Source: { rich_text: [{ text: { content: source } }] },
    Created: { date: { start: receivedIso } },
    Raw: { rich_text: chunkToRichTextBlocks(rawText) },
    Processed: { rich_text: [] }
  };
}

export async function createInboxItemFromEmail(env, { subject, rawText, receivedIso }) {
  const source = "Email";
  const properties = buildBaseProperties({ subject, rawText, receivedIso, source });

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

    throw new Error(`Failed to create inbox page: ${fallbackResult.text || ""}`);
  }

  throw new Error(`Failed to create inbox page: ${result.text || ""}`);
}
