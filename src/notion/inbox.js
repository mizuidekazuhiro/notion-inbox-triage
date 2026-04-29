import { notionHeaders } from "./client.js";

export async function fetchInbox(env) {
  const res = await fetch(
    `https://api.notion.com/v1/databases/${env.INBOX_DB_ID}/query`,
    {
      method: "POST",
      headers: notionHeaders(env),
      body: JSON.stringify({
      filter: {
        and: [
          {
            property: "Processed",
            rich_text: { is_empty: true }
          },
          {
            property: "Processed At",
            date: { is_empty: true }
          }
        ]
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

export async function fetchWidgetInbox(env, limit) {
  const requestBody = {
    filter: {
      and: [
        {
          property: "Processed",
          rich_text: { is_empty: true }
        },
        {
          property: "Processed At",
          date: { is_empty: true }
        }
      ]
    },
    sorts: [
      {
        property: "Created",
        direction: "descending"
      }
    ]
  };

  const [countRes, listRes] = await Promise.all([
    fetch(`https://api.notion.com/v1/databases/${env.INBOX_DB_ID}/query`, {
      method: "POST",
      headers: notionHeaders(env),
      body: JSON.stringify({ ...requestBody, page_size: 100 })
    }),
    fetch(`https://api.notion.com/v1/databases/${env.INBOX_DB_ID}/query`, {
      method: "POST",
      headers: notionHeaders(env),
      body: JSON.stringify({ ...requestBody, page_size: limit })
    })
  ]);

  if (!countRes.ok || !listRes.ok) {
    throw new Error("Failed to fetch widget inbox");
  }

  const [countData, listData] = await Promise.all([countRes.json(), listRes.json()]);
  const count = Number(countData?.results?.length || 0);
  const items = (listData?.results || []).map((page) => ({
    id: page.id,
    title: page.properties.Name?.title?.[0]?.plain_text || "無題",
    url: page.url || "",
    created_time: page.created_time || page.last_edited_time || ""
  }));

  return { count, items };
}
