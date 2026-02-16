import { notionHeaders } from "../notion/client";

class ProjectsFetchError extends Error {
  constructor(message, notionStatus, notionErrorExcerpt) {
    super(message);
    this.name = "ProjectsFetchError";
    this.notionStatus = notionStatus;
    this.notionErrorExcerpt = notionErrorExcerpt;
  }
}

function truncateError(value) {
  return value.slice(0, 300);
}

function buildProjectsFromResults(results) {
  return (results ?? [])
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
}

async function fetchProjectsFromNotion(env) {
  let res;
  let notionStatus = null;

  try {
    res = await fetch(
      `https://api.notion.com/v1/databases/${env.PROJECTS_DB_ID}/query`,
      {
        method: "POST",
        headers: notionHeaders(env),
        body: JSON.stringify({
          page_size: 100,
          sorts: [{ property: "名前", direction: "ascending" }],
          filter: {
            or: [
              { property: "Status", status: { equals: "Active" } },
              { property: "Status", status: { equals: "Hold" } }
            ]
          }
        })
      }
    );
    notionStatus = res.status;
  } catch (error) {
    const notionErrorExcerpt = truncateError(
      String(error?.message || error || "")
    );
    throw new ProjectsFetchError(
      "Failed to fetch projects",
      null,
      notionErrorExcerpt
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const notionErrorExcerpt = truncateError(text);
    throw new ProjectsFetchError(
      `Failed to fetch projects: ${text}`,
      notionStatus,
      notionErrorExcerpt
    );
  }

  const data = await res.json();
  return { data, notionStatus };
}

async function getProjectsShortcutData(env) {
  const { data, notionStatus } = await fetchProjectsFromNotion(env);
  const projects = buildProjectsFromResults(data.results ?? []);
  return { projects, notionStatus };
}

function buildChoicesFromProjects(projects) {
  const seenLabels = new Set();
  const choices = [];

  for (const project of projects) {
    if (seenLabels.has(project.label)) {
      console.warn("Duplicate project label", project.label);
      continue;
    }
    seenLabels.add(project.label);
    choices.push({ label: project.label, value: project.value });
  }

  return choices;
}

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

  let projects = [];
  let notionStatus = null;
  let notionErrorExcerpt = "";

  try {
    const data = await getProjectsShortcutData(env);
    projects = data.projects;
    notionStatus = data.notionStatus;
  } catch (error) {
    if (error instanceof ProjectsFetchError) {
      notionStatus = error.notionStatus ?? null;
      notionErrorExcerpt = error.notionErrorExcerpt ?? "";
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
      return new Response(error.message, { status: 500 });
    }

    if (debugEnabled) {
      return new Response(
        JSON.stringify({
          ok: false,
          projects_db_id_present: projectsDbIdPresent,
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
    return new Response("Failed to fetch projects", { status: 500 });
  }

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

export async function handleProjectsChoices(request, env) {
  if (!env.PROJECTS_DB_ID) {
    return new Response(
      JSON.stringify({ error: "PROJECTS_DB_ID is not configured" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }

  try {
    const { projects } = await getProjectsShortcutData(env);
    const choices = buildChoicesFromProjects(projects);
    const labels = choices.map((choice) => choice.label);
    const byLabel = choices.reduce((accumulator, choice) => {
      if (choice.label in accumulator) {
        console.warn("Duplicate project label", choice.label);
      }
      accumulator[choice.label] = choice.value;
      return accumulator;
    }, {});
    return new Response(JSON.stringify({ choices, labels, by_label: byLabel }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300"
      }
    });
  } catch (error) {
    const message =
      error instanceof ProjectsFetchError
        ? error.message
        : "Failed to fetch projects";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
}
