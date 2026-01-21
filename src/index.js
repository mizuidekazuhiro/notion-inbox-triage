import { inboxList } from "./routes/inbox";
import { fetchInbox } from "./notion/inbox";
import { buildInboxMail } from "./mail/buildInboxMail";
import { buildTasksDigestMail } from "./mail/buildTasksDigestMail";
import { getTask, queryTasksByStatus, updateTaskStatus } from "./notion/tasks";
import { extractBodyText, extractSubject } from "./email/parseEmail";
import { createInboxItemFromEmail } from "./notion/inboxCreate";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // =====================
    // ① トークン確認
    // =====================
    if (url.pathname === "/test/token") {
      return Response.json({
        token_exists: !!env.NOTION_TOKEN,
        token_head: env.NOTION_TOKEN?.slice(0, 10),
        token_length: env.NOTION_TOKEN?.length
      });
    }

    // =====================
    // API: Inbox JSON（Python用）
    // =====================
    if (url.pathname === "/api/inbox") {
      return inboxList(request, env);
    }

    // =====================
    // API: Inbox choices（iOSショートカット用）
    // 返す形式: { choices: [ { label, value }, ... ] }
    // =====================
    if (url.pathname === "/api/inbox/shortcut") {
      const inbox = await fetchInbox(env);

      // ★最小修正：fetchInboxが未処理のみ返している前提なので、追加filterはしない
      const choices = inbox.map((item) => ({
        label: item.title || "Untitled",
        value: item.id
      }));

      return new Response(JSON.stringify({ choices }), {
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Cache-Control": "no-store"
        }
      });
    }

    // =====================
    // API: Tasks Do JSON
    // =====================
    if (url.pathname === "/api/tasks/do") {
      const items = await queryTasksByStatus(env, "Do");
      const sorted = sortTasksBySince(items, "sinceDoISO");
      return jsonResponse({ count: sorted.length, items: sorted });
    }

    // =====================
    // API: Tasks Someday JSON
    // =====================
    if (url.pathname === "/api/tasks/someday") {
      const items = await queryTasksByStatus(env, "Someday");
      const sorted = sortTasksBySince(items, "sinceSomedayISO");
      return jsonResponse({ count: sorted.length, items: sorted });
    }
    
    // =====================
    // Inbox HTML（ブラウザ確認用）
    // =====================
    if (url.pathname === "/inbox") {
      const inbox = await fetchInbox(env);
      const html = buildInboxMail(inbox, env.BASE_URL);

      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          "Cache-Control": "no-store"
        }
      });
    }

    // =====================
    // テスト用：mailto生成
    // =====================
    if (url.pathname === "/mail/content") {
      const inbox = await fetchInbox(env);
      const body = buildInboxMail(inbox, env.BASE_URL);

      return new Response(
        JSON.stringify({
          subject: `Inbox｜${inbox.length} 件`,
          body,
          count: inbox.length
        }),
        {
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    // =====================
    // Tasks Digest Mail (JSON)
    // =====================
    if (url.pathname === "/mail/digest") {
      const result = await buildTasksDigestData({
        env,
        baseUrl: env.BASE_URL || url.origin
      });

      return jsonResponse(result);
    }

    // =====================
    // Test: create inbox item from query params
    // =====================
    if (url.pathname === "/test/inbox/create") {
      const subject = (url.searchParams.get("subject") || "").trim() || "(no subject)";
      const body = url.searchParams.get("body") || "";
      const receivedIso = new Date().toISOString();
      const rawText = buildRawText({
        body,
        from: "test",
        receivedIso
      });

      await createInboxItemFromEmail(env, { subject, rawText, receivedIso });

      return jsonResponse({ ok: true });
    }

    // =====================
    // ③ Inbox → Tasks（ショートカット用：POST JSON）
    // 受け取るJSON: { "id": "<pageId>", "status": "Do" }
    // ====================
    if (url.pathname === "/action/move") {
      // GET: /action/move?id=...&status=Do
      if (request.method === "GET") {
        const pageId = (url.searchParams.get("id") || "").trim();
        const status = normalizeStatus(url.searchParams.get("status") || "");

        const allowedStatus = ["Inbox", "Do", "Thinking", "Someday", "Waiting", "Done", "Drop"];

        if (!pageId || !status) {
          return new Response("id and status are required", { status: 400 });
        }
        if (!allowedStatus.includes(status)) {
          return new Response("invalid status", { status: 400 });
        }

        return handleMoveCore({ env, pageId, status });
      }

      // POST: JSON body {id, status}
      return handleMoveByBody(request, env);
    }

    // =====================
    // Undo
    // =====================
    if (url.pathname === "/action/undo") {
      return handleUndo(url, env);
    }

    // =====================
    // Confirm screen
    // =====================
    if (url.pathname === "/confirm") {
      return handleConfirm(url, env);
    }

    // =====================
    // Action: update task status (POST only)
    // =====================
    if (url.pathname === "/action/task/update") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return handleTaskUpdate(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTasksDigestMail(env));
  },

  async email(message, env, ctx) {
    const subject = extractSubject(message);
    const body = await extractBodyText(message);
    const receivedIso = new Date().toISOString();
    const rawText = buildRawText({
      body,
      from: message.headers.get("from") || "",
      messageId: message.headers.get("message-id") || "",
      receivedIso
    });

    ctx.waitUntil(createInboxItemFromEmail(env, { subject, rawText, receivedIso }));
  }
};

// =====================
// Move handler (POST JSON body)
// =====================
async function handleMoveByBody(request, env) {
  // Optional: shared secret for shortcuts
  // SHORTCUT_TOKEN を env に入れた場合だけチェック
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

  const pageId = typeof body?.id === "string" ? body.id.trim() : "";
  const status = normalizeStatus(typeof body?.status === "string" ? body.status : "");

  const allowedStatus = ["Inbox", "Do", "Thinking", "Someday", "Waiting", "Done", "Drop"];

  if (!pageId || !status) {
    return new Response("id and status are required", { status: 400 });
  }

  if (!allowedStatus.includes(status)) {
    return new Response(`invalid status`, { status: 400 });
  }

  return handleMoveCore({ env, pageId, status });
}

// =====================
// Move core
// =====================
async function handleMoveCore({ env, pageId, status }) {

  
  // =====================
  // Inbox ページ取得
  // =====================
  const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: notionHeaders(env)
  });

  // ★最小修正：okチェックを先に（json()例外→1101対策）
  if (!pageRes.ok) {
    const text = await pageRes.text().catch(() => "");
    return new Response(`Failed to fetch inbox page: ${text}`, { status: 500 });
  }

  const page = await pageRes.json();

  // =====================
  // すでに処理済みなら何もしない
  // =====================
  const processedText =
  page.properties["Processed"]?.rich_text?.[0]?.plain_text?.trim() || "";

  const processedAt =
    page.properties["Processed At"]?.date?.start || "";
  
  if (processedText || processedAt) {
    return new Response("Already processed", { status: 200 });
  }
  
  // ★最小修正：now を復活（未定義→1101対策）
  const now = new Date().toISOString();

  // =====================
  // 即ロック（軽い二重実行対策）
  // =====================
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

  // =====================
  // Tasks 作成
  // =====================
  const createRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(env),
    body: JSON.stringify({
      parent: { database_id: env.TASKS_DB_ID },
      properties: {
        名前: { title: [{ text: { content: title } }] },
        Status: { select: { name: status } },
        "Triage Source": { select: { name: "Shortcut" } },
        "Triage At": { date: { start: now } },
        "Inbox Page ID": {
          rich_text: [{ text: { content: pageId } }]
        }
      }
    })
  });

  if (!createRes.ok) {
    return new Response("Failed to create task", { status: 500 });
  }

  // =====================
  // Inbox 更新
  // =====================
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

  return new Response(`Moved to ${status}`, { status: 200 });
}

// =====================
// Undo handler
// =====================
async function handleUndo(url, env) {
  const taskId = url.searchParams.get("task_id");
  if (!taskId) {
    return new Response("task_id required", { status: 400 });
  }

  const taskRes = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
    headers: notionHeaders(env)
  });

  if (!taskRes.ok) {
    return new Response("Task not found", { status: 404 });
  }

  const task = await taskRes.json();
  const inboxPageId = task.properties["Inbox Page ID"]?.rich_text?.[0]?.plain_text;

  if (!inboxPageId) {
    return new Response("Inbox Page ID not found", { status: 400 });
  }

  await fetch(`https://api.notion.com/v1/pages/${inboxPageId}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({
      properties: {
        Processed: { rich_text: [] },
        "Processed At": { date: null }
      }
    })
  });

  await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({ archived: true })
  });

  return new Response(`<html><body><script>window.close()</script></body></html>`, {
    headers: { "Content-Type": "text/html; charset=UTF-8" }
  });
}

// =====================
// Helpers
// =====================
function notionHeaders(env) {
  return {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };
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

function buildRawText({ body, from, messageId, receivedIso }) {
  const metadataLines = [
    "---",
    `from: ${from || "-"}`,
    `received_at: ${receivedIso}`,
    ...(messageId ? [`message-id: ${messageId}`] : [])
  ];

  return [body.trim(), "", ...metadataLines].join("\n");
}

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ALLOWED_ACTION_STATUS = ["Do", "Thinking", "Waiting", "Done", "Drop", "Someday"];

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function toJstDate(date) {
  return new Date(date.getTime() + JST_OFFSET_MS);
}

function startOfJstDay(date) {
  const jst = toJstDate(date);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  const day = jst.getUTCDate();
  return new Date(Date.UTC(year, month, day) - JST_OFFSET_MS);
}

function getJstDateParts(date) {
  const jst = toJstDate(date);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth(),
    day: jst.getUTCDate(),
    dayOfWeek: jst.getUTCDay()
  };
}

function getJstDateString(date) {
  const { year, month, day } = getJstDateParts(date);
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function parseJstDateStart(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day) - JST_OFFSET_MS);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return startOfJstDay(date);
}

function sortTasksBySince(items, key) {
  return [...items].sort((a, b) => {
    const aDate = parseJstDateStart(a[key]);
    const bDate = parseJstDateStart(b[key]);
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate.getTime() - bDate.getTime();
  });
}

async function fetchHolidaysJson() {
  const cache = caches.default;
  const cacheKey = new Request("https://holidays-jp.github.io/api/v1/date.json");
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached.json();
  }

  const res = await fetch(cacheKey, {
    headers: {
      "Cache-Control": "max-age=86400"
    }
  });

  if (!res.ok) {
    return {};
  }

  await cache.put(cacheKey, res.clone());
  return res.json();
}

function isBusinessDay(date, holidays) {
  const { dayOfWeek } = getJstDateParts(date);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }
  const dateStr = getJstDateString(date);
  return !holidays[dateStr];
}

function isFirstBusinessDayOfWeek(todayStart, holidays) {
  const { dayOfWeek } = getJstDateParts(todayStart);
  const offset = (dayOfWeek + 6) % 7;
  const mondayStart = new Date(todayStart.getTime() - offset * DAY_MS);

  for (
    let cursor = mondayStart.getTime();
    cursor <= todayStart.getTime();
    cursor += DAY_MS
  ) {
    const date = new Date(cursor);
    if (isBusinessDay(date, holidays)) {
      return date.getTime() === todayStart.getTime();
    }
  }
  return false;
}

async function buildTasksDigestData({ env, baseUrl }) {
  const todayStart = startOfJstDay(new Date());
  const todayJstStr = getJstDateString(todayStart);
  const holidays = await fetchHolidaysJson();
  const weekStart = isFirstBusinessDayOfWeek(todayStart, holidays);

  const doItems = sortTasksBySince(
    await queryTasksByStatus(env, "Do"),
    "sinceDoISO"
  );

  const somedayItems = weekStart
    ? sortTasksBySince(await queryTasksByStatus(env, "Someday"), "sinceSomedayISO")
    : [];

  const subject = weekStart
    ? `Tasks｜Do ${doItems.length}件 / Someday ${somedayItems.length}件`
    : `Tasks｜Do ${doItems.length}件`;

  const body = buildTasksDigestMail({
    doItems,
    somedayItems,
    baseUrl,
    weekStart,
    todayJstStr
  });

  return {
    subject,
    body,
    week_start: weekStart,
    count_do: doItems.length,
    count_someday: somedayItems.length,
    today_jst: todayJstStr
  };
}

async function runTasksDigestMail(env) {
  const result = await buildTasksDigestData({
    env,
    baseUrl: env.BASE_URL
  });

  return { ...result, sent: false };
}

async function handleConfirm(url, env) {
  if (!env.ACTION_SECRET) {
    return new Response("Missing ACTION_SECRET", { status: 500 });
  }

  const taskId = (url.searchParams.get("task_id") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();

  if (!taskId || !to) {
    return new Response("task_id and to are required", { status: 400 });
  }
  if (!ALLOWED_ACTION_STATUS.includes(to)) {
    return new Response("invalid status", { status: 400 });
  }

  let task;
  try {
    task = await getTask(env, taskId);
  } catch (error) {
    return new Response(error?.message || "Failed to fetch task", { status: 500 });
  }

  const taskName = task.properties["名前"]?.title?.[0]?.plain_text ?? "Untitled";
  const currentStatus = task.properties.Status?.select?.name ?? "-";
  const exp = String(Date.now() + 10 * 60 * 1000);
  const sig = await createActionSignature(env.ACTION_SECRET, taskId, to, exp);

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
    <h2 style="margin-top:0;">更新確認</h2>
    <p style="margin:0 0 8px 0;"><strong>${taskName}</strong></p>
    <p style="color:#555; margin:0 0 16px 0;">現在: ${currentStatus} → 変更先: ${to}</p>
    <form method="POST" action="/action/task/update">
      <input type="hidden" name="task_id" value="${taskId}">
      <input type="hidden" name="to" value="${to}">
      <input type="hidden" name="exp" value="${exp}">
      <input type="hidden" name="sig" value="${sig}">
      <button type="submit" style="
        padding: 12px 20px;
        background:#1a73e8;
        border:none;
        color:#fff;
        border-radius:8px;
        font-size:16px;
      ">Confirm</button>
    </form>
  </div>
</body>
</html>
`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

async function handleTaskUpdate(request, env) {
  if (!env.ACTION_SECRET) {
    return new Response("Missing ACTION_SECRET", { status: 500 });
  }

  const form = await request.formData();
  const taskId = String(form.get("task_id") || "").trim();
  const to = String(form.get("to") || "").trim();
  const exp = String(form.get("exp") || "").trim();
  const sig = String(form.get("sig") || "").trim();

  if (!taskId || !to || !exp || !sig) {
    return new Response("invalid payload", { status: 400 });
  }
  if (!ALLOWED_ACTION_STATUS.includes(to)) {
    return new Response("invalid status", { status: 400 });
  }

  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() > expNum) {
    return new Response("signature expired", { status: 403 });
  }

  const expected = await createActionSignature(env.ACTION_SECRET, taskId, to, exp);
  if (!safeEqual(expected, sig)) {
    return new Response("invalid signature", { status: 403 });
  }

  try {
    await updateTaskStatus(env, taskId, to);
  } catch (error) {
    return new Response(error?.message || "Failed to update task", { status: 500 });
  }

  return new Response(
    "<html><body><p>更新しました。</p><script>window.close()</script></body></html>",
    { headers: { "Content-Type": "text/html; charset=UTF-8" } }
  );
}

async function createActionSignature(secret, taskId, to, exp) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = encoder.encode(`${taskId}|${to}|${exp}`);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return toHex(signature);
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
