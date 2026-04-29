import { fetchInbox } from "../notion/inbox.js";
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

export async function handleWidgetInbox(request, env) {
  const shortcutToken = env.SHORTCUT_TOKEN;
  if (!shortcutToken) {
    return new Response(JSON.stringify({ ok: false, error: "shortcut_token_not_configured" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store"
      }
    });
  }

  const url = new URL(request.url);
  const headerToken = request.headers.get("X-Shortcut-Token");
  const queryToken = url.searchParams.get("token");
  const providedToken = headerToken || queryToken;

  if (providedToken !== shortcutToken) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store"
      }
    });
  }

  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "5", 10);
  const limit = Math.min(10, Math.max(1, Number.isNaN(rawLimit) ? 5 : rawLimit));

  try {
    const inbox = await fetchInbox(env);
    const items = inbox.slice(0, limit).map((item) => ({
      id: item.id,
      title: item.title || "(No title)",
      created: item.created || ""
    }));

    return new Response(
      JSON.stringify({
        ok: true,
        generated_at: new Date().toISOString(),
        count: items.length,
        items
      }),
      {
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    console.error("handleWidgetInbox failed", error?.stack || error);
    return new Response(JSON.stringify({ ok: false, error: "failed_to_fetch_inbox" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store"
      }
    });
  }
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
