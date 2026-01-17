import { inboxList } from "./routes/inbox";
import { fetchInbox } from "./notion/inbox";
import { buildInboxMail } from "./mail/buildInboxMail";
//import { sendMail } from "./mail/sendMail";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // =====================
    // ① トークン確認
    // =====================
    if (url.pathname === "/test/token") {
      return Response.json({
        token_exists: !!env.NOTION_TOKEN,
        token_head: env.NOTION_TOKEN?.slice(0, 10),
        token_length: env.NOTION_TOKEN?.length
      });
    }

    // =====================
    // API: Inbox JSON（Python用）
    // =====================
    if (url.pathname === "/api/inbox") {
      return inboxList(request, env);
    }

    // =====================
    // API: Inbox choices（iOSショートカット用・安定版）
    // 返す形式: ["title||id", ...]
    // =====================
    if (url.pathname === "/api/inbox/shortcut") {
      const inbox = await fetchInbox(env);
    
      const choices = inbox.map((item) => {
        const title = (item.title || "Untitled").split("||").join(" ");
        return `${title}||${item.id}`;
      });
    
      return new Response(JSON.stringify(choices), {
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Cache-Control": "no-store"
        }
      });
    }
    
    // =====================
    // Inbox HTML（ブラウザ確認用）
    // =====================
    if (url.pathname === "/inbox") {
      const inbox = await fetchInbox(env);
      const html = buildInboxMail(inbox, env.BASE_URL);

      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          "Cache-Control": "no-store"
        }
      });
    }

    // =====================
    // テスト用：mailto生成
    // =====================
    if (url.pathname === "/mail/content") {
      const inbox = await fetchInbox(env);
      const body = buildInboxMail(inbox, env.BASE_URL);

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

    // =====================
    // ③ Inbox → Tasks（ショートカット用：POST JSON）
    // 受け取るJSON: { "id": "<pageId>", "status": "Do" }
    // =====================
    if (url.pathname === "/action/move") {
      return handleMoveByBody(request, env);
    }

    // =====================
    // Undo
    // =====================
    if (url.pathname === "/action/undo") {
      return handleUndo(url, env);
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event, env, ctx) {}
};

// =====================
// Move handler (POST JSON body)
// =====================
async function handleMoveByBody(request, env) {
  // Optional: shared secret for shortcuts
  // SHORTCUT_TOKEN を env に入れた場合だけチェック
  if (env.SHORTCUT_TOKEN) {
    const token = request.headers.get("X-Shortcut-Token");
    if (token !== env.SHORTCUT_TOKEN) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const pageId = typeof body?.id === "string" ? body.id.trim() : "";
  const status = normalizeStatus(typeof body?.status === "string" ? body.status : "");

  const allowedStatus = ["Inbox", "Do", "Someday", "Waiting", "Done", "Drop"];

  if (!pageId || !status) {
    return new Response("id and status are required", { status: 400 });
  }

  if (!allowedStatus.includes(status)) {
    return new Response(`invalid status`, { status: 400 });
  }

  return handleMoveCore({ env, pageId, status });
}

// =====================
// Move core
// =====================
async function handleMoveCore({ env, pageId, status }) {
  // =====================
  // Inbox ページ取得
  // =====================
  const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: notionHeaders(env)
  });

  const page = await pageRes.json();
  if (!pageRes.ok) {
    return new Response("Failed to fetch inbox page", { status: 500 });
  }

  // =====================
  // すでに処理済みなら何もしない
  // =====================
  if (page.properties["Processed At"]?.date?.start) {
    return new Response("Already processed", { status: 200 });
  }

  const now = new Date().toISOString();

  // =====================
  // 即ロック（軽い二重実行対策）
  // =====================
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({
      properties: {
        Processed: {
          rich_text: [{ text: { content: "processing..." } }]
        }
      }
    })
  });

  const title = page.properties.Name?.title?.[0]?.text?.content ?? "Untitled";

  // =====================
  // Tasks 作成
  // =====================
  const createRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(env),
    body: JSON.stringify({
      parent: { database_id: env.TASKS_DB_ID },
      properties: {
        名前: { title: [{ text: { content: title } }] },
        Status: { select: { name: status } },
        "Triage Source": { select: { name: "Shortcut" } },
        "Triage At": { date: { start: now } },
        "Inbox Page ID": {
          rich_text: [{ text: { content: pageId } }]
        }
      }
    })
  });

  if (!createRes.ok) {
    return new Response("Failed to create task", { status: 500 });
  }

  // =====================
  // Inbox 更新
  // =====================
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({
      properties: {
        Processed: {
          rich_text: [{ text: { content: `Moved to ${status}` } }]
        },
        "Processed At": { date: { start: now } }
      }
    })
  });

  return new Response(`Moved to ${status}`, { status: 200 });
}

// =====================
// Undo handler
// =====================
async function handleUndo(url, env) {
  const taskId = url.searchParams.get("task_id");
  if (!taskId) {
    return new Response("task_id required", { status: 400 });
  }

  const taskRes = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
    headers: notionHeaders(env)
  });

  if (!taskRes.ok) {
    return new Response("Task not found", { status: 404 });
  }

  const task = await taskRes.json();
  const inboxPageId = task.properties["Inbox Page ID"]?.rich_text?.[0]?.plain_text;

  if (!inboxPageId) {
    return new Response("Inbox Page ID not found", { status: 400 });
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

// =====================
// Helpers
// =====================
function notionHeaders(env) {
  return {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };
}

function normalizeStatus(s) {
  const x = (s || "").trim().toLowerCase();
  if (x === "do") return "Do";
  if (x === "done") return "Done";
  if (x === "waiting") return "Waiting";
  if (x === "someday") return "Someday";
  if (x === "drop") return "Drop";
  if (x === "inbox") return "Inbox";
  // すでに正しい表記ならそのまま
  if (s === "Do" || s === "Done" || s === "Waiting" || s === "Someday" || s === "Drop" || s === "Inbox") {
    return s;
  }
  return s;
}