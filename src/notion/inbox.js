export async function fetchInbox(env) {
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
        filter: {
          property: "Processed",
          rich_text: {
            is_empty: true
          }
        },
        sorts: [
          {
            property: "Created",
            direction: "ascending"
          }
        ]
      })
    }
  );

  if (!res.ok) {
    throw new Error("Failed to fetch inbox");
  }

  const data = await res.json();

  return data.results.map(page => ({
    id: page.id,
    title:
      page.properties.Name?.title?.[0]?.plain_text ?? "Untitled",
    created:
      page.properties.Created?.date?.start ?? ""
  }));
}
