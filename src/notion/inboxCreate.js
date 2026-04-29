import { chunkToRichTextBlocks } from "../email/parseEmail";
import { notionHeaders } from "./notionHeaders";

export async function createInboxItem(env, { subject, rawText, receivedIso }) {
  if (!env.NOTION_TOKEN) {
    console.error("NOTION_TOKEN is missing. Skipping Notion inbox creation.");
    return null;
  }
  if (!env.INBOX_DB_ID) {
    console.error("INBOX_DB_ID is missing. Skipping Notion inbox creation.");
    return null;
  }

  const properties = {
    Name: { title: [{ text: { content: subject } }] },
    Source: { rich_text: [{ text: { content: "Email" } }] },
    Created: { date: { start: receivedIso } },
    Raw: { rich_text: chunkToRichTextBlocks(rawText, 1800) },
    Processed: { rich_text: [] }
  };

  let res;
  try {
    res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: notionHeaders(env),
      body: JSON.stringify({
        parent: { database_id: env.INBOX_DB_ID },
        properties
      })
    });
  } catch (error) {
    console.error("Notion create request failed", error);
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Notion create failed", { status: res.status, text });
    return null;
  }

  try {
    return await res.json();
  } catch (error) {
    console.error("Notion response JSON parse failed", error);
    return null;
  }
}
