import { notionHeaders } from "../notion/client";

export async function handleProjectsShortcut(request, env) {
  if (!env.PROJECTS_DB_ID) {
    return new Response("PROJECTS_DB_ID is not configured", { status: 500 });
  }

  const res = await fetch(
    `https://api.notion.com/v1/databases/${env.PROJECTS_DB_ID}/query`,
    {
      method: "POST",
      headers: notionHeaders(env),
      body: JSON.stringify({
        page_size: 100,
        sorts: [{ property: "名前", direction: "ascending" }]
      })
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return new Response(`Failed to fetch projects: ${text}`, { status: 500 });
  }

  const data = await res.json();
  const choices = (data.results ?? [])
    .map((page) => {
      const titleProperty = Object.values(page.properties ?? {}).find(
        (property) => property?.type === "title"
      );
      const titleText = (titleProperty?.title ?? [])
        .map((item) => item?.plain_text)
        .filter(Boolean)
        .join("")
        .trim();
      return {
        label: titleText || "Untitled",
        value: page.id
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return new Response(JSON.stringify({ choices }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
