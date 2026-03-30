import { notionHeaders } from "../notion/client";
import { copyPageBody } from "../notion/blocks";
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
const READ_ONLY_PROPERTY_TYPES = new Set([
  "formula",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
  "verification",
  "button"
]);
const SYSTEM_MANAGED_PROPERTY_NAMES = new Set([
  "Processed",
  "Processed At",
  "Undo URL",
  "Inbox Page ID",
  "Triage Source",
  "Triage At",
  "Status"
]);
const COPYABLE_PROPERTY_TYPES = new Set([
  "title",
  "rich_text",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "url",
  "email",
  "phone_number",
  "number",
  "relation",
  "people"
]);

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

  let pageRes;
  let inboxDbRes;
  let tasksDbRes;

  try {
    [pageRes, inboxDbRes, tasksDbRes] = await Promise.all([
      fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        headers: notionHeaders(env)
      }),
      fetchDatabaseSchema(env, env.INBOX_DB_ID),
      fetchDatabaseSchema(env, env.TASKS_DB_ID)
    ]);
  } catch (error) {
    const message = error?.message || 'Failed to fetch Notion schema';
    console.error(message);
    return new Response(message, { status: 500 });
  }

  if (!pageRes.ok) {
    const text = await pageRes.text().catch(() => "");
    return new Response(`Failed to fetch inbox page: ${text}`, { status: 500 });
  }

  const page = await pageRes.json();
  const inboxDatabase = inboxDbRes;
  const tasksDatabase = tasksDbRes;

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

  const properties = buildTaskPropertiesFromInboxPage({
    inboxPage: page,
    inboxDbSchema: inboxDatabase,
    tasksDbSchema: tasksDatabase,
    pageId,
    status,
    now,
    priority,
    dueDate,
    reminderDate,
    projectId
  });

  const createRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(env),
    body: JSON.stringify({
      parent: { database_id: env.TASKS_DB_ID },
      properties
    })
  });

  if (!createRes.ok) {
    const errorText = await createRes.text().catch(() => "");
    const message = `Failed to create task: ${errorText}`;
    console.error(message);

    if (debug) {
      return new Response(
        JSON.stringify(
          {
            error: "Failed to create task",
            notion_response: errorText || null,
            properties,
            body: debug.body,
            headers: debug.headers
          },
          null,
          2
        ),
        {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    return new Response(message, { status: 500 });
  }

  const createdTask = await createRes.json();
  const createdTaskId = createdTask?.id;
  let bodyCopySummary = null;

  if (!createdTaskId) {
    const message = `Task created but id missing for sourcePageId=${pageId}`;
    console.error(message);
    return new Response(message, { status: 500 });
  }

  try {
    bodyCopySummary = await copyPageBody(env, pageId, createdTaskId);
    console.info(
      JSON.stringify({
        message: "move.body.copy.success",
        sourcePageId: pageId,
        createdTaskId,
        sourceTopLevelBlockCount: bodyCopySummary.sourceTopLevelCount,
        appendedBlockCount: bodyCopySummary.appendedCount,
        skippedBlockCount: bodyCopySummary.skippedCount,
        unsupportedBlockTypes: bodyCopySummary.skippedTypes,
        appendBatchCount: bodyCopySummary.batchCount
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "move.body.copy.failed",
        sourcePageId: pageId,
        createdTaskId,
        failedBlockTypes: error?.failedBlockTypes || [],
        notionStatus: error?.notionStatus || null,
        notionResponseBody: error?.notionBody || null,
        stack: error?.stack || String(error)
      })
    );

    if (createdTaskId) {
      try {
        const cleanupRes = await fetch(`https://api.notion.com/v1/pages/${createdTaskId}`, {
          method: "PATCH",
          headers: notionHeaders(env),
          body: JSON.stringify({ archived: true })
        });
        if (!cleanupRes.ok) {
          const cleanupText = await cleanupRes.text().catch(() => "");
          console.error(
            JSON.stringify({
              message: "move.body.copy.cleanup.failed",
              sourcePageId: pageId,
              createdTaskId,
              notionStatus: cleanupRes.status,
              notionResponseBody: cleanupText
            })
          );
        }
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            message: "move.body.copy.cleanup.exception",
            sourcePageId: pageId,
            createdTaskId,
            stack: cleanupError?.stack || String(cleanupError)
          })
        );
      }
    }

    const failureMessage = `Failed to copy page body (sourcePageId=${pageId}, createdTaskId=${createdTaskId || "unknown"})`;
    if (debug) {
      return new Response(
        JSON.stringify(
          {
            error: failureMessage,
            source_page_id: pageId,
            created_task_id: createdTaskId ?? null,
            failed_block_types: error?.failedBlockTypes || [],
            notion_status: error?.notionStatus || null,
            notion_response: error?.notionBody || null,
            body: debug.body,
            headers: debug.headers
          },
          null,
          2
        ),
        {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }
    return new Response(failureMessage, { status: 500 });
  }

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
          body_copy_summary: bodyCopySummary,
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

async function fetchDatabaseSchema(env, databaseId) {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    headers: notionHeaders(env)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch database schema (${databaseId}): ${text}`);
  }

  return res.json();
}

function detectTitlePropertyName(database) {
  const entries = Object.entries(database?.properties || {});
  const found = entries.find(([, schema]) => schema?.type === "title");
  return found?.[0] || null;
}

function buildTaskPropertiesFromInboxPage({
  inboxPage,
  inboxDbSchema,
  tasksDbSchema,
  pageId,
  status,
  now,
  priority,
  dueDate,
  reminderDate,
  projectId
}) {
  const properties = {};
  const inboxProperties = inboxPage?.properties || {};
  const inboxSchema = inboxDbSchema?.properties || {};
  const tasksSchema = tasksDbSchema?.properties || {};
  const sourceTitleName = detectTitlePropertyName(inboxDbSchema);
  const targetTitleName = detectTitlePropertyName(tasksDbSchema);

  for (const [sourcePropertyName, sourceProperty] of Object.entries(inboxProperties)) {
    if (SYSTEM_MANAGED_PROPERTY_NAMES.has(sourcePropertyName)) continue;

    const targetPropertySchema = tasksSchema[sourcePropertyName];
    if (!targetPropertySchema) continue;

    const copiedValue = copyCompatiblePropertyValue({
      sourcePropertyName,
      sourceProperty,
      sourcePropertySchema: inboxSchema[sourcePropertyName],
      targetPropertySchema
    });

    if (copiedValue) {
      properties[sourcePropertyName] = copiedValue;
    }
  }

  if (sourceTitleName && targetTitleName) {
    const sourceTitle = inboxProperties[sourceTitleName];
    const copiedTitle = copyCompatiblePropertyValue({
      sourcePropertyName: sourceTitleName,
      sourceProperty: sourceTitle,
      sourcePropertySchema: inboxSchema[sourceTitleName],
      targetPropertySchema: tasksSchema[targetTitleName]
    });

    if (copiedTitle) {
      properties[targetTitleName] = copiedTitle;
    }
  }

  properties.Status = { select: { name: status } };
  properties["Triage Source"] = { select: { name: "Shortcut" } };
  properties["Triage At"] = { date: { start: now } };
  properties["Inbox Page ID"] = {
    rich_text: [{ text: { content: pageId } }]
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
  }

  if (status === "Waiting" && reminderDate) {
    properties["Reminder Date"] = { date: { start: reminderDate } };
  }

  return properties;
}

function copyCompatiblePropertyValue({
  sourcePropertyName,
  sourceProperty,
  sourcePropertySchema,
  targetPropertySchema
}) {
  const sourceType = sourceProperty?.type || sourcePropertySchema?.type;
  const targetType = targetPropertySchema?.type;

  if (!sourceType || !targetType) return null;
  if (READ_ONLY_PROPERTY_TYPES.has(sourceType) || READ_ONLY_PROPERTY_TYPES.has(targetType)) {
    return null;
  }
  if (!COPYABLE_PROPERTY_TYPES.has(sourceType) || !COPYABLE_PROPERTY_TYPES.has(targetType)) {
    return null;
  }
  if (sourceType !== targetType) return null;

  switch (targetType) {
    case "title": {
      return { title: Array.isArray(sourceProperty?.title) ? sourceProperty.title : [] };
    }
    case "rich_text": {
      return {
        rich_text: Array.isArray(sourceProperty?.rich_text) ? sourceProperty.rich_text : []
      };
    }
    case "select": {
      const name = sourceProperty?.select?.name;
      return name ? { select: { name } } : null;
    }
    case "multi_select": {
      const items = Array.isArray(sourceProperty?.multi_select)
        ? sourceProperty.multi_select
            .map((item) => (item?.name ? { name: item.name } : null))
            .filter(Boolean)
        : [];
      return { multi_select: items };
    }
    case "date": {
      if (!sourceProperty?.date) return null;
      const { start, end = null, time_zone = null } = sourceProperty.date;
      if (!start) return null;
      return { date: { start, end, time_zone } };
    }
    case "checkbox": {
      return { checkbox: Boolean(sourceProperty?.checkbox) };
    }
    case "url": {
      if (!sourceProperty?.url) return null;
      return { url: sourceProperty.url };
    }
    case "email": {
      if (!sourceProperty?.email) return null;
      return { email: sourceProperty.email };
    }
    case "phone_number": {
      if (!sourceProperty?.phone_number) return null;
      return { phone_number: sourceProperty.phone_number };
    }
    case "number": {
      if (typeof sourceProperty?.number !== "number") return null;
      return { number: sourceProperty.number };
    }
    case "relation": {
      const relation = Array.isArray(sourceProperty?.relation)
        ? sourceProperty.relation
            .map((item) => (item?.id ? { id: item.id } : null))
            .filter(Boolean)
        : [];
      return { relation };
    }
    case "people": {
      const people = Array.isArray(sourceProperty?.people)
        ? sourceProperty.people
            .map((person) => (person?.id ? { id: person.id } : null))
            .filter(Boolean)
        : [];
      return { people };
    }
    default:
      console.warn(`Unsupported property copy type for ${sourcePropertyName}: ${targetType}`);
      return null;
  }
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
