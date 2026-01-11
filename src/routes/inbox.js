export async function inboxList(request, env) {
  const url = new URL(request.url);
  const baseUrl = url.origin;

  const res = await fetch(
    `https://api.notion.com/v1/databases/${env.INBOX_DB_ID}/query`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        page_size: 20,
        sorts: [{ property: "Created", direction: "ascending" }]
      })
    }
  );

  const data = await res.json();

  const items = (data.results ?? []).map(page => ({
    id: page.id,
    title: page.properties.Name?.title?.[0]?.text?.content ?? "(No title)",
    created: page.properties.Created?.date?.start ?? null,
    actions: {
      do: `${baseUrl}/action/move?id=${page.id}&status=Do`,
      waiting: `${baseUrl}/action/move?id=${page.id}&status=Waiting`,
      someday: `${baseUrl}/action/move?id=${page.id}&status=Someday`,
      done: `${baseUrl}/action/move?id=${page.id}&status=Done`,
      drop: `${baseUrl}/action/move?id=${page.id}&status=Drop`
    }
  }));

  return Response.json({
    generated_at: new Date().toISOString(),
    count: items.length,
    items
  });
}
