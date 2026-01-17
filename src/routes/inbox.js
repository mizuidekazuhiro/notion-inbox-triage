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