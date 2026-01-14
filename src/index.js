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
    // Inbox HTML（ブラウザ確認用）
    // =====================
    if (url.pathname === "/inbox") {
      const inbox = await fetchInbox(env);
      const html = buildInboxMail(inbox, env.BASE_URL);

      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=UTF-8"
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
            "Content-Type": "application/json; charset=UTF-8"
          }
        }
      );
    }

    // =====================
    // ③ Inbox → Tasks
    // =====================
    if (url.pathname === "/action/move") {

      // =====================
      // GET：確認画面のみ（副作用なし）
      // =====================
      if (request.method === "GET") {
        const pageId = url.searchParams.get("id");
        const status = url.searchParams.get("status");

        if (!pageId || !status) {
          return new Response("Invalid request", { status: 400 });
        }

        return new Response(
          `
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1">
            </head>
            <body style="font-family:sans-serif">
              <h3>このタスクを「${status}」にしますか？</h3>

              <form method="POST" action="/action/move">
                <input type="hidden" name="id" value="${pageId}">
                <input type="hidden" name="status" value="${status}">
                <button type="submit">確定</button>
              </form>

              <p style="font-size:12px;color:#666;">
                ※ この画面は確認用です
              </p>
            </body>
          </html>
          `,
          { headers: { "Content-Type": "text/html; charset=UTF-8" } }
        );
      }

      // =====================
      // POST：ここから本処理
      // =====================
      if (request.method === "POST") {
        const form = await request.formData();
        const pageId = form.get("id");
        const status = form.get("status");

        const allowedStatus = [
          "Inbox",
          "Do",
          "Someday",
          "Waiting",
          "Done",
          "Drop"
        ];

        if (!pageId || !status) {
          return new Response("id and status are required", { status: 400 });
        }

        if (!allowedStatus.includes(status)) {
          return new Response("invalid status", { status: 400 });
        }

        // =====================
        // 重複チェック
        // =====================
        const dupRes = await fetch(
          `https://api.notion.com/v1/databases/${env.TASKS_DB_ID}/query`,
          {
            method: "POST",
            headers: notionHeaders(env),
            body: JSON.stringify({
              filter: {
                property: "Inbox Page ID",
                rich_text: { equals: pageId }
              }
            })
          }
        );

        const dup = await dupRes.json();
        if (dup.results?.length > 0) {
          return new Response(
            `<html><body><script>window.close()</script></body></html>`,
            { headers: { "Content-Type": "text/html; charset=UTF-8" } }
          );
        }

        // =====================
        // Inbox ページ取得
        // =====================
        const pageRes = await fetch(
          `https://api.notion.com/v1/pages/${pageId}`,
          { headers: notionHeaders(env) }
        );

        const page = await pageRes.json();
        if (!pageRes.ok) {
          return new Response("Failed to fetch inbox page", { status: 500 });
        }

        // =====================
        // ロックチェック
        // =====================
        if (page.properties["Processed At"]?.date?.start) {
          return new Response(
            `<html><body><script>window.close()</script></body></html>`,
            { headers: { "Content-Type": "text/html; charset=UTF-8" } }
          );
        }

        const now = new Date().toISOString();

        // =====================
        // 即ロック
        // =====================
        await fetch(
          `https://api.notion.com/v1/pages/${pageId}`,
          {
            method: "PATCH",
            headers: notionHeaders(env),
            body: JSON.stringify({
              properties: {
                Processed: {
                  rich_text: [{ text: { content: "processing..." } }]
                }
              }
            })
          }
        );

        const title =
          page.properties.Name?.title?.[0]?.text?.content ?? "Untitled";

        // =====================
        // Tasks 作成
        // =====================
        const createRes = await fetch(
          "https://api.notion.com/v1/pages",
          {
            method: "POST",
            headers: notionHeaders(env),
            body: JSON.stringify({
              parent: { database_id: env.TASKS_DB_ID },
              properties: {
                名前: { title: [{ text: { content: title } }] },
                Status: { select: { name: status } },
                "Triage Source": { select: { name: "Manual (URL click)" } },
                "Triage At": { date: { start: now } },
                "Inbox Page ID": {
                  rich_text: [{ text: { content: pageId } }]
                }
              }
            })
          }
        );

        const created = await createRes.json();
        if (!createRes.ok) {
          return new Response("Failed to create task", { status: 500 });
        }

        const taskId = created.id;

        // =====================
        // Undo URL
        // =====================
        await fetch(
          `https://api.notion.com/v1/pages/${taskId}`,
          {
            method: "PATCH",
            headers: notionHeaders(env),
            body: JSON.stringify({
              properties: {
                "Undo URL": {
                  url: `${url.origin}/action/undo?task_id=${taskId}`
                }
              }
            })
          }
        );

        // =====================
        // Inbox 更新
        // =====================
        await fetch(
          `https://api.notion.com/v1/pages/${pageId}`,
          {
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
          }
        );

        return new Response(
          `<html><body><script>window.close()</script></body></html>`,
          { headers: { "Content-Type": "text/html; charset=UTF-8" } }
        );
      }

      return new Response("Method Not Allowed", { status: 405 });
    }

    // =====================
    // Undo
    // =====================
    if (url.pathname === "/action/undo") {
      return handleUndo(url, env);
    }

    return new Response("Not Found", { status: 404 });
  },

  // =====================
  // Cron（毎朝）
  // =====================
  async scheduled(event, env, ctx) {}
};

// =====================
// Undo handler
// =====================
async function handleUndo(url, env) {
  const taskId = url.searchParams.get("task_id");
  if (!taskId) {
    return new Response("task_id required", { status: 400 });
  }

  const taskRes = await fetch(
    `https://api.notion.com/v1/pages/${taskId}`,
    { headers: notionHeaders(env) }
  );

  if (!taskRes.ok) {
    return new Response("Task not found", { status: 404 });
  }

  const task = await taskRes.json();
  const inboxPageId =
    task.properties["Inbox Page ID"]?.rich_text?.[0]?.plain_text;

  if (!inboxPageId) {
    return new Response("Inbox Page ID not found", { status: 400 });
  }

  await fetch(
    `https://api.notion.com/v1/pages/${inboxPageId}`,
    {
      method: "PATCH",
      headers: notionHeaders(env),
      body: JSON.stringify({
        properties: {
          Processed: { rich_text: [] },
          "Processed At": { date: null }
        }
      })
    }
  );

  await fetch(
    `https://api.notion.com/v1/pages/${taskId}`,
    {
      method: "PATCH",
      headers: notionHeaders(env),
      body: JSON.stringify({ archived: true })
    }
  );

  return new Response(
    `<html><body><script>window.close()</script></body></html>`,
    { headers: { "Content-Type": "text/html; charset=UTF-8" } }
  );
}

function notionHeaders(env) {
  return {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };
}