export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)

    if (url.pathname !== "/triage") {
      return new Response("Not Found", { status: 404 })
    }

    // === Notion API にテストページを作る ===
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: env.TASKS_DB_ID },
        properties: {
          Name: {
            title: [
              {
                text: {
                  content: "API Test Task",
                },
              },
            ],
          },
          Status: {
            select: {
              name: "Do",
            },
          },
          Source: {
            multi_select: [
              { name: "Mail" },
            ],
          },
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      return new Response(text, { status: 500 })
    }

    return new Response("Task created in Tasks DB 🎉")
  },
}
