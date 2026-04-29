import { fetchInbox, fetchWidgetInbox } from "../notion/inbox.js";
import { jsonResponse } from "../utils/http.js";
import { buildDoWaitingItems, sortTasksBySince, startOfJstDay } from "../utils/tasksDigest.js";
import { queryDoWaitingTasks, queryTasksByStatus } from "../notion/tasks.js";
import { buildInboxMail } from "../mail/buildInboxMail.js";
import { buildTasksDigestData } from "./tasksDigest.js";

export async function handleInboxList(request, env) {
  return inboxList(request, env);
}

export async function inboxList(request, env) {
  const url = new URL(request.url);
  const baseUrl = url.origin;

  const res = await fetch(
    `https://api.notion.com/v1/databases/${env.INBOX_DB_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        page_size: 20,
        sorts: [{ property: "Created", direction: "ascending" }],
        filter: {
          and: [
            {
              property: "Processed At",
              date: { is_empty: true }
            },
            {
              property: "Processed",
              rich_text: { is_empty: true }
            }
          ]
        }
      })
    }
  );

  const data = await res.json();

  const items = (data.results ?? []).map((page) => ({
    id: page.id,
    title: page.properties.Name?.title?.[0]?.text?.content ?? "(No title)",
    created: page.properties.Created?.date?.start ?? null,
    actions: {
      Do: `${baseUrl}/action/move?id=${page.id}&status=Do`,
      Thinking: `${baseUrl}/action/move?id=${page.id}&status=Thinking`,
      Waiting: `${baseUrl}/action/move?id=${page.id}&status=Waiting`,
      Someday: `${baseUrl}/action/move?id=${page.id}&status=Someday`,
      Done: `${baseUrl}/action/move?id=${page.id}&status=Done`,
      Drop: `${baseUrl}/action/move?id=${page.id}&status=Drop`
    }
  }));

  return new Response(
    JSON.stringify({
      generated_at: new Date().toISOString(),
      count: items.length,
      items
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=UTF-8"
      }
    }
  );
}

export async function handleInboxShortcut(request, env) {
  const inbox = await fetchInbox(env);

  const choices = inbox.map((item) => ({
    label: item.title || "Untitled",
    value: item.id
  }));

  return new Response(JSON.stringify({ choices }), {
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function handleInboxHtml(request, env) {
  const inbox = await fetchInbox(env);
  const html = await buildInboxMail(inbox, env.BASE_URL, env.ACTION_SECRET);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function handleMailContent(request, env) {
  const inbox = await fetchInbox(env);
  const body = await buildInboxMail(inbox, env.BASE_URL, env.ACTION_SECRET);

  return new Response(
    JSON.stringify({
      subject: `Inbox｜${inbox.length} 件`,
      body,
      count: inbox.length
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

export async function handleTasksDo(env) {
  const items = await queryTasksByStatus(env, "Do");
  const sorted = sortTasksBySince(items, "sinceDoISO");
  return jsonResponse({ count: sorted.length, items: sorted });
}

export async function handleTasksSomeday(env) {
  const items = await queryTasksByStatus(env, "Someday");
  const sorted = sortTasksBySince(items, "sinceSomedayISO");
  return jsonResponse({ count: sorted.length, items: sorted });
}

export async function handleTasksDoWaiting(env) {
  const todayStart = startOfJstDay(new Date());
  const items = await queryDoWaitingTasks(env);
  const doWaitingItems = buildDoWaitingItems(items, todayStart);
  const sorted = sortTasksBySince(doWaitingItems, "digestSinceISO");
  return jsonResponse({ count: sorted.length, items: sorted });
}

export async function handleTasksDigestMail(request, env) {
  const url = new URL(request.url);
  const result = await buildTasksDigestData({
    env,
    baseUrl: env.BASE_URL || url.origin
  });

  return jsonResponse(result);
}

function parseWidgetLimit(request) {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") || "5", 10);
  if (!Number.isFinite(raw) || raw <= 0) return 5;
  return Math.min(raw, 50);
}

export async function handleWidgetInbox(request, env) {
  const limit = parseWidgetLimit(request);

  if (!env.SHORTCUT_TOKEN) {
    console.log(JSON.stringify({ event: "widget_inbox_request", limit, success: false, count: 0, error: "shortcut_token_missing" }));
    return jsonResponse({ ok: false, error: "shortcut_token_missing" }, 500);
  }

  const token = request.headers.get("X-Shortcut-Token");
  if (!token || token !== env.SHORTCUT_TOKEN) {
    console.log(JSON.stringify({ event: "widget_inbox_request", limit, success: false, count: 0, error: "unauthorized" }));
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const { count, items } = await fetchWidgetInbox(env, limit);
    console.log(JSON.stringify({ event: "widget_inbox_request", limit, success: true, count }));
    return jsonResponse({ ok: true, count, items });
  } catch (error) {
    console.log(JSON.stringify({ event: "widget_inbox_request", limit, success: false, count: 0, error: error?.message || "notion_error" }));
    return jsonResponse({ ok: false, error: "notion_error" }, 502);
  }
}
