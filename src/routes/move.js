import { notionHeaders } from "../notion/client";
import { normalizeJstDateString } from "../utils/date";
import { createUndoSignature } from "../utils/signature";

const ALLOWED_STATUS = ["Inbox", "Do", "Thinking", "Someday", "Waiting", "Done", "Drop"];
const DEBUG_HEADER_ALLOWLIST = [
  "content-type",
  "accept",
  "user-agent",
  "x-debug",
  "x-shortcut-token"
];

export async function handleMove(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const pageId = (url.searchParams.get("id") || "").trim();
    const status = normalizeStatus(url.searchParams.get("status") || "");

    if (!pageId || !status) {
      return new Response("id and status are required", { status: 400 });
    }
    if (!ALLOWED_STATUS.includes(status)) {
      return new Response("invalid status", { status: 400 });
    }

    return handleMoveCore({ env, pageId, status, baseUrl: url.origin });
  }

  return handleMoveByBody(request, env);
}

async function handleMoveByBody(request, env) {
  if (env.SHORTCUT_TOKEN) {
    const token = request.headers.get("X-Shortcut-Token");
    if (token !== env.SHORTCUT_TOKEN) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).length === 1 &&
    Object.keys(body)[0] === "" &&
    body[""] &&
    typeof body[""] === "object" &&
    !Array.isArray(body[""])
  ) {
    body = body[""];
  }

  const isDebug = request.headers.get("X-Debug") === "1";
  const debugHeaders = isDebug ? buildDebugHeaders(request.headers) : null;

  const pageIdSource = coerceString(body?.inbox_page_id) || coerceString(body?.id);
  const pageId = pageIdSource.trim();
  const statusRaw = coerceString(body?.status).trim();
  const status = normalizeStatus(statusRaw);
  const priority =
    typeof body?.priority === "string" && body.priority.trim()
      ? body.priority.trim()
      : null;
  const dueDate = normalizeJstDateString(body?.due_date ?? null);
  const reminderDate = normalizeJstDateString(body?.reminder_date ?? null);
  const projectId =
    typeof body?.project_id === "string" && body.project_id.trim()
      ? body.project_id.trim()
      : null;

  if (!pageId || !status) {
    if (isDebug) {
      return new Response(
        JSON.stringify(
          {
            error: "id and status are required",
            got: {
              id: body?.id ?? null,
              inbox_page_id: body?.inbox_page_id ?? null,
              status: body?.status ?? null
            },
            keys: Object.keys(body || {}),
            body,
            headers: debugHeaders
          },
          null,
          2
        ),
        {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }
    return new Response("id and status are required", { status: 400 });
  }

  if (!ALLOWED_STATUS.includes(status)) {
    return new Response("invalid status", { status: 400 });
  }

  const url = new URL(request.url);

  return handleMoveCore({
    env,
    pageId,
    status,
    priority,
    dueDate,
    reminderDate,
    projectId,
    baseUrl: url.origin,
    debug: isDebug ? { body, headers: debugHeaders } : null
  });
}

export async function handleMoveCore({
  env,
  pageId,
  status,
  priority,
  dueDate,
  reminderDate,
  projectId,
  baseUrl,
  debug
}) {
  const resolvedBaseUrl = baseUrl || env.BASE_URL || "";

  const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: notionHeaders(env)
  });

  if (!pageRes.ok) {
    const text = await pageRes.text().catch(() => "");
    return new Response(`Failed to fetch inbox page: ${text}`, { status: 500 });
  }

  const page = await pageRes.json();

  const processedText =
    page.properties["Processed"]?.rich_text?.[0]?.plain_text?.trim() || "";

  const processedAt = page.properties["Processed At"]?.date?.start || "";

  if (processedText || processedAt) {
    return new Response("Already processed", { status: 200 });
  }

  const now = new Date().toISOString();

  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({
      properties: {
        Processed: {
          rich_text: [{ text: { content: "processing..." } }]
        }
      }
    })
  });

  const title = page.properties.Name?.title?.[0]?.text?.content ?? "Untitled";

  const properties = {
    名前: { title: [{ text: { content: title } }] },
    Status: { select: { name: status } },
    "Triage Source": { select: { name: "Shortcut" } },
    "Triage At": { date: { start: now } },
    "Inbox Page ID": {
      rich_text: [{ text: { content: pageId } }]
    }
  };

  if (status === "Do") {
    if (priority) {
      properties.Priority = { select: { name: priority } };
    }
    if (dueDate) {
      properties["Due Date"] = { date: { start: dueDate } };
    }
    if (projectId) {
      properties.Project = { relation: [{ id: projectId }] };
    }
  } else if (status === "Waiting" && reminderDate) {
    properties["Reminder Date"] = { date: { start: reminderDate } };
  }

  const createRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(env),
    body: JSON.stringify({
      parent: { database_id: env.TASKS_DB_ID },
      properties
    })
  });

  if (!createRes.ok) {
    return new Response("Failed to create task", { status: 500 });
  }

  const createdTask = await createRes.json();
  const createdTaskId = createdTask?.id;

  let undoUrlWithSig = "";

  if (createdTaskId && env.ACTION_SECRET && resolvedBaseUrl) {
    const undoSig = await createUndoSignature(env.ACTION_SECRET, pageId, createdTaskId);
    undoUrlWithSig = `${resolvedBaseUrl}/undo?inbox_page_id=${encodeURIComponent(
      pageId
    )}&task_id=${encodeURIComponent(createdTaskId)}&sig=${encodeURIComponent(undoSig)}`;
    const undoProperty = buildUndoUrlProperty({
      undoUrl: undoUrlWithSig,
      propertyType: createdTask?.properties?.["Undo URL"]?.type
    });

    try {
      const undoRes = await fetch(
        `https://api.notion.com/v1/pages/${createdTaskId}`,
        {
          method: "PATCH",
          headers: notionHeaders(env),
          body: JSON.stringify({
            properties: {
              "Undo URL": undoProperty
            }
          })
        }
      );

      if (!undoRes.ok) {
        const text = await undoRes.text().catch(() => "");
        console.error("Failed to update Undo URL", text);
      }
    } catch (error) {
      console.error("Failed to update Undo URL", error?.stack || error);
    }
  } else if (createdTaskId && !env.ACTION_SECRET) {
    console.error("Missing ACTION_SECRET; Undo URL not written");
  } else if (createdTaskId && !resolvedBaseUrl) {
    console.error("Missing baseUrl; Undo URL not written");
  }

  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({
      properties: {
        Processed: {
          rich_text: [{ text: { content: `Moved to ${status}` } }]
        },
        "Processed At": { date: { start: now } }
      }
    })
  });

  const undoPath = createdTaskId ? `/undo?task_id=${createdTaskId}` : "";
  const undoUrl =
    undoUrlWithSig || (resolvedBaseUrl ? `${resolvedBaseUrl}${undoPath}` : undoPath);
  const undoLink = undoUrl
    ? `<a href="${undoUrl}" style="color:#1a73e8;">Undo</a>`
    : "Undo link unavailable";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  background:#f7f7f7;
  padding:16px;
">
  <div style="background:#fff; border-radius:12px; padding:16px;">
    <p style="margin:0 0 12px 0;">Moved to ${status}</p>
    <p style="margin:0;">${undoLink}</p>
  </div>
</body>
</html>
`;

  if (debug) {
    return new Response(
      JSON.stringify(
        {
          ok: true,
          moved_to: status,
          inbox_page_id: pageId,
          created_task_id: createdTaskId ?? null,
          undo_url: undoUrlWithSig || undoUrl,
          body: debug.body,
          headers: debug.headers
        },
        null,
        2
      ),
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=UTF-8" }
  });
}

function buildUndoUrlProperty({ undoUrl, propertyType }) {
  if (propertyType === "rich_text") {
    return { rich_text: [{ text: { content: undoUrl } }] };
  }
  return { url: undoUrl };
}

function normalizeStatus(s) {
  const x = (s || "").trim().toLowerCase();
  if (x === "do") return "Do";
  if (x === "thinking") return "Thinking";
  if (x === "done") return "Done";
  if (x === "waiting") return "Waiting";
  if (x === "someday") return "Someday";
  if (x === "drop") return "Drop";
  if (x === "inbox") return "Inbox";
  if (
    s === "Do" ||
    s === "Thinking" ||
    s === "Done" ||
    s === "Waiting" ||
    s === "Someday" ||
    s === "Drop" ||
    s === "Inbox"
  ) {
    return s;
  }
  return s;
}

export function normalizeMoveStatus(value) {
  return normalizeStatus(value);
}

function coerceString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if (typeof value.value === "string") return value.value;
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function buildDebugHeaders(headers) {
  const output = {};
  for (const name of DEBUG_HEADER_ALLOWLIST) {
    const value = headers.get(name);
    if (value !== null) {
      output[name] = name === "x-shortcut-token" ? "***" : value;
    }
  }
  return output;
}
