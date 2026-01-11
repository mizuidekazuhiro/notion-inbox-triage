export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // =====================
    // ① トークン確認
    // =====================
    if (url.pathname === "/test/token") {
      return Response.json({
        token_exists: !!env.NOTION_TOKEN,
        token_head: env.NOTION_TOKEN?.slice(0, 10),
        token_length: env.NOTION_TOKEN?.length
      })
    }

    // =====================
    // ② Inbox DB 取得テスト
    // =====================
    if (url.pathname === "/test/inbox") {
      const res = await fetch(
        `https://api.notion.com/v1/databases/${env.INBOX_DB_ID}/query`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ page_size: 1 })
        }
      )

      const data = await res.json()

      return Response.json({
        ok: res.ok,
        status: res.status,
        results_count: data.results?.length ?? 0,
        sample: data.results?.[0] ?? null
      })
    }

    // =====================
    // ③ Tasks DB スキーマ確認
    // =====================
    if (url.pathname === "/test/tasks-schema") {
      const res = await fetch(
        `https://api.notion.com/v1/databases/${env.TASKS_DB_ID}`,
        {
          headers: {
            "Authorization": `Bearer ${env.NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28"
          }
        }
      )

      const data = await res.json()
      return Response.json(data.properties)
    }

    // =====================
    // ④ Inbox → Tasks に1件移動
    // =====================
    if (url.pathname === "/test/move-one") {
      // Inbox から1件取得
      const inboxRes = await fetch(
        `https://api.notion.com/v1/databases/${env.INBOX_DB_ID}/query`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ page_size: 1 })
        }
      )

      const inboxData = await inboxRes.json()
      const page = inboxData.results?.[0]

      if (!page) {
        return Response.json({ error: "Inbox is empty" }, { status: 400 })
      }

      // Inbox 側の title（Name）
      const title =
        page.properties.Name?.title?.[0]?.text?.content ?? "Untitled"

      // Tasks DB に作成
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
              // ★ Tasks DB の title 名は「名前」
              "名前": {
                title: [{ text: { content: title } }]
              },
              Status: {
                select: { name: "Inbox" }
              }
            }
          })
        }
      )

      const created = await createRes.json()

      return Response.json({
        created_ok: createRes.ok,
        task_id: created.id ?? null,
        error: createRes.ok ? null : created
      })
    }

    return new Response("Not Found", { status: 404 })
  }
}
