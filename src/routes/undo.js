import { notionHeaders } from "../notion/client";
import { createUndoSignature, safeEqual } from "../utils/signature";

export async function handleUndo(url, env) {
  const taskId = url.searchParams.get("task_id");
  const inboxPageIdParam = (url.searchParams.get("inbox_page_id") || "").trim();
  const sig = (url.searchParams.get("sig") || "").trim();
  if (!taskId) {
    return new Response("task_id required", { status: 400 });
  }

  let inboxPageId = inboxPageIdParam;

  if (sig) {
    if (!env.ACTION_SECRET) {
      return new Response("Missing ACTION_SECRET", { status: 500 });
    }
    if (!inboxPageIdParam) {
      return new Response("inbox_page_id required", { status: 400 });
    }
    const expected = await createUndoSignature(env.ACTION_SECRET, inboxPageIdParam, taskId);
    if (!safeEqual(expected, sig)) {
      return new Response("invalid signature", { status: 403 });
    }
  }

  if (!inboxPageId) {
    const taskRes = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
      headers: notionHeaders(env)
    });

    if (!taskRes.ok) {
      return new Response("Task not found", { status: 404 });
    }

    const task = await taskRes.json();
    inboxPageId = task.properties["Inbox Page ID"]?.rich_text?.[0]?.plain_text;

    if (!inboxPageId) {
      return new Response("Inbox Page ID not found", { status: 400 });
    }
  }

  await fetch(`https://api.notion.com/v1/pages/${inboxPageId}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({
      properties: {
        Processed: { rich_text: [] },
        "Processed At": { date: null }
      }
    })
  });

  await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({ archived: true })
  });

  return new Response(`<html><body><script>window.close()</script></body></html>`, {
    headers: { "Content-Type": "text/html; charset=UTF-8" }
  });
}
