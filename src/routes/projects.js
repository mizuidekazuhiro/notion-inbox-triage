import { notionHeaders } from "../notion/client";

export async function handleProjectsShortcut(request, env) {
  const url = new URL(request.url);
  const debugEnabled = url.searchParams.get("debug") === "1";
  const projectsDbIdPresent = !!env.PROJECTS_DB_ID;
  const notionTokenPresent = !!env.NOTION_TOKEN;

  if (!projectsDbIdPresent) {
    if (debugEnabled) {
      return new Response(
        JSON.stringify({
          ok: false,
          projects_db_id_present: false,
          notion_token_present: notionTokenPresent,
          notion_status: null,
          notion_error_excerpt: "",
          choices_count: 0
        }),
        {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }
    return new Response("PROJECTS_DB_ID is not configured", { status: 500 });
  }

  let res;
  let notionStatus = null;
  let notionErrorExcerpt = "";
  const truncateError = (value) => value.slice(0, 300);

  try {
    res = await fetch(
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
    notionStatus = res.status;
  } catch (error) {
    notionErrorExcerpt = truncateError(String(error?.message || error || ""));
    if (debugEnabled) {
      return new Response(
        JSON.stringify({
          ok: false,
          projects_db_id_present: projectsDbIdPresent,
          notion_token_present: notionTokenPresent,
          notion_status: null,
          notion_error_excerpt: notionErrorExcerpt,
          choices_count: 0
        }),
        {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }
    return new Response("Failed to fetch projects", { status: 500 });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    notionErrorExcerpt = truncateError(text);
    if (debugEnabled) {
      return new Response(
        JSON.stringify({
          ok: false,
          projects_db_id_present: projectsDbIdPresent,
          notion_token_present: notionTokenPresent,
          notion_status: notionStatus,
          notion_error_excerpt: notionErrorExcerpt,
          choices_count: 0
        }),
        {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }
    return new Response(`Failed to fetch projects: ${text}`, { status: 500 });
  }

  const data = await res.json();
  const projects = (data.results ?? [])
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

  const labels = projects.map((project) => project.label);
  const byLabel = projects.reduce((accumulator, project) => {
    accumulator[project.label] = project.value;
    return accumulator;
  }, {});

  if (debugEnabled) {
    return new Response(
      JSON.stringify({
        ok: true,
        projects_db_id_present: projectsDbIdPresent,
        notion_token_present: notionTokenPresent,
        notion_status: notionStatus,
        notion_error_excerpt: "",
        choices_count: projects.length
      }),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }

  return new Response(
    JSON.stringify({
      labels,
      by_label: byLabel
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}
