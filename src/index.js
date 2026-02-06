import { runDailyInboxMail } from "./jobs/dailyInboxMail";
import { runTasksDigestMail } from "./jobs/tasksDigestMail";
import { handleInboxList, handleInboxShortcut, handleInboxHtml, handleMailContent, handleTasksDo, handleTasksDoWaiting, handleTasksSomeday, handleTasksDigestMail } from "./routes/inbox";
import { handleMove } from "./routes/move";
import { handleUndo } from "./routes/undo";
import { handleConfirm, handleTaskUpdate } from "./routes/confirm";
import { handleProjectsShortcut, handleProjectsChoices } from "./routes/projects";
import { sanitizeSubject, readMessageBody } from "./email/parseEmail";
import { createInboxItem } from "./notion/inboxCreate";
import { jsonResponse } from "./utils/http";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/test/token") {
      return Response.json({
        token_exists: !!env.NOTION_TOKEN,
        token_head: env.NOTION_TOKEN?.slice(0, 10),
        token_length: env.NOTION_TOKEN?.length
      });
    }

    if (url.pathname === "/api/inbox") {
      return handleInboxList(request, env);
    }

    if (url.pathname === "/api/inbox/shortcut") {
      return handleInboxShortcut(request, env);
    }

    if (url.pathname === "/api/projects/shortcut") {
      return handleProjectsShortcut(request, env);
    }

    if (url.pathname === "/api/projects/choices") {
      return handleProjectsChoices(request, env);
    }

    if (url.pathname === "/api/tasks/do") {
      return handleTasksDo(env);
    }

    if (url.pathname === "/api/tasks/do-waiting") {
      return handleTasksDoWaiting(env);
    }

    if (url.pathname === "/api/tasks/someday") {
      return handleTasksSomeday(env);
    }

    if (url.pathname === "/inbox") {
      return handleInboxHtml(request, env);
    }

    if (url.pathname === "/mail/content") {
      return handleMailContent(request, env);
    }

    if (url.pathname === "/mail/digest") {
      return handleTasksDigestMail(request, env);
    }

    if (url.pathname === "/test/email-to-inbox") {
      const subject = sanitizeSubject(url.searchParams.get("subject"));
      const body = url.searchParams.get("body") || "";
      const result = await processTextToInbox(env, subject, body);
      if (result.ok) {
        return new Response("OK", { status: 200 });
      }
      return new Response("Failed to create inbox item", { status: 500 });
    }

    if (url.pathname === "/test/inbox/create") {
      const subject = sanitizeSubject(url.searchParams.get("subject"));
      const body = url.searchParams.get("body") || "";

      await processTextToInbox(env, subject, body);

      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/action/move") {
      return handleMove(request, env);
    }

    if (url.pathname === "/action/undo" || url.pathname === "/undo") {
      return handleUndo(url, env);
    }

    if (url.pathname === "/confirm") {
      return handleConfirm(url, env);
    }

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
    try {
      ctx.waitUntil(processInboundEmail(message, env));
    } catch (error) {
      console.error("email handler scheduling failed", error);
    }
    return;
  }
};

async function processInboundEmail(message, env) {
  try {
    const subject = sanitizeSubject(message.headers.get("subject"));
    const from = message.headers.get("from") || "";
    const msgId = message.headers.get("message-id") || "";
    const receivedIso = new Date().toISOString();
    const bodyText = await readMessageBody(message);
    const rawText = buildRawText({ bodyText, from, msgId, receivedIso });

    await createInboxItem(env, { subject, rawText, receivedIso });
  } catch (error) {
    console.error("processInboundEmail failed", error?.stack || error);
  }
}

async function processTextToInbox(env, subject, bodyText) {
  try {
    const receivedIso = new Date().toISOString();
    const rawText = buildRawText({
      bodyText,
      from: "",
      msgId: "",
      receivedIso
    });
    const result = await createInboxItem(env, { subject, rawText, receivedIso });
    return { ok: !!result };
  } catch (error) {
    console.error("processTextToInbox failed", error?.stack || error);
    return { ok: false };
  }
}

function buildRawText({ bodyText, from, msgId, receivedIso }) {
  const metadataLines = [
    "---",
    `from: ${from || "-"}`,
    `message-id: ${msgId || "-"}`,
    `received_at: ${receivedIso}`
  ];

  return [bodyText?.trim() || "", "", ...metadataLines].join("\n");
}
