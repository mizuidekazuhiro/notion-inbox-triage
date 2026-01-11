import { inboxList } from "./routes/inbox";

export default {
  async fetch(request, env) {
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
    // ③ Inbox → Tasks
    // =====================
    if (url.pathname === "/action/move") {
      const pageId = url.searchParams.get("id");
      const status = url.searchParams.get("status");


    // =====================
    // Status 制御（追加）
    // =====================
      const allowedStatus = [
        "Inbox",
        "Do",
        "Someday",
        "Waiting",
        "Done",
        "Drop"
      ];

      if (!allowedStatus.includes(status)) {
        return Response.json(
          {
            error: "invalid status",
            allowedStatus
          },
          { status: 400 }
        );
      }


      if (!pageId || !status) {
        return Response.json(
          { error: "id and status are required" },
          { status: 400 }
        );
      }

      const pageRes = await fetch(
        `https://api.notion.com/v1/pages/${pageId}`,
        {
          headers: {
            "Authorization": `Bearer ${env.NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28"
          }
        }
      );

      const page = await pageRes.json();
      if (!pageRes.ok) {
        return Response.json(
          { error: "Failed to fetch inbox page", detail: page },
          { status: 500 }
        );
      }

      const title =
        page.properties.Name?.title?.[0]?.text?.content ?? "Untitled";
      const now = new Date().toISOString();

      // Tasks 作成
      const createRes = await fetch(
        "https://api.notion.com/v1/pages",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            parent: { database_id: env.TASKS_DB_ID },
            properties: {
              "名前": { title: [{ text: { content: title } }] },
              Status: { select: { name: status } },
              "Triage Source": {
                select: { name: "Manual (URL click)" }
              },
              "Triage At": { date: { start: now } },
              // ★ Undo 用
              "Inbox Page ID": {
                rich_text: [{ text: { content: pageId } }]
              }
            }
          })
        }
      );


      const created = await createRes.json();
      if (!createRes.ok) {
        return Response.json(
          { error: "Failed to create task", detail: created },
          { status: 500 }
        );
      }

      const taskId = created.id;

      // Undo URL を Task に書き込む
      await fetch(
        `https://api.notion.com/v1/pages/${taskId}`,
        {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${env.NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            properties: {
              "Undo URL": {
                url: `${url.origin}/action/undo?task_id=${taskId}`
              }
            }
          })
        }
      );

      // Inbox 更新（archiveしない）
      await fetch(
        `https://api.notion.com/v1/pages/${pageId}`,
        {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${env.NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json"
          },
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

      return Response.json({
        ok: true,
        moved_to: status,
        task_id: created.id
      });
    }

    if (url.pathname === "/action/undo") {
      return handleUndo(url, env);
    }
    
    
    return new Response("Not Found", { status: 404 });
  },


  //毎朝実行Cron
    async scheduled(event, env, ctx) {
    console.log("Daily cron job executed");
  }
};

async function handleUndo(url, env) {
  const taskId = url.searchParams.get("task_id");

  if (!taskId) {
    return new Response("task_id required", { status: 400 });
  }

  /* =====================
     Task を取得
  ===================== */
  const taskRes = await fetch(
    `https://api.notion.com/v1/pages/${taskId}`,
    {
      headers: notionHeaders(env),
    }
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

  /* =====================
     Inbox を未処理に戻す
  ===================== */
  await fetch(
    `https://api.notion.com/v1/pages/${inboxPageId}`,
    {
      method: "PATCH",
      headers: notionHeaders(env),
      body: JSON.stringify({
        properties: {
          Processed: {
            rich_text: []
          },
          "Processed At": {
            date: null
          }
        }
      })
    }
  );


  /* =====================
     Task を archive
  ===================== */
  await fetch(
    `https://api.notion.com/v1/pages/${taskId}`,
    {
      method: "PATCH",
      headers: notionHeaders(env),
      body: JSON.stringify({
        archived: true,
      }),
    }
  );

  return new Response("Undo completed");
}
function notionHeaders(env) {
  return {
    "Authorization": `Bearer ${env.NOTION_TOKEN}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };
}

    return new Response("Not Found", { status: 404 });

