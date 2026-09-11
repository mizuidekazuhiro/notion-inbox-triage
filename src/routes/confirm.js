import {
  getTask,
  updateTaskReminderDate,
  updateTaskStatus
} from "../notion/tasks.js";
import { DAY_MS, getJstDateString, startOfJstDay } from "../utils/date.js";
import { createActionSignature, safeEqual } from "../utils/signature.js";

const ALLOWED_ACTION_STATUS = ["Do", "Thinking", "Waiting", "Done", "Drop", "Someday"];
const ALLOWED_SNOOZE_DAYS = [1, 3, 7];

function snoozeActionKey(days) {
  return `snooze:${days}`;
}

function resolveSnoozeDate(days, now = new Date()) {
  const todayStart = startOfJstDay(now);
  return getJstDateString(new Date(todayStart.getTime() + days * DAY_MS));
}

export async function handleConfirm(url, env) {
  if (!env.ACTION_SECRET) {
    return new Response("Missing ACTION_SECRET", { status: 500 });
  }

  const taskId = (url.searchParams.get("task_id") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();
  const snoozeDays = Number.parseInt(url.searchParams.get("snooze_days") || "", 10);
  const isStatusAction = !!to;
  const isSnoozeAction = !isStatusAction && ALLOWED_SNOOZE_DAYS.includes(snoozeDays);

  if (!taskId || (!isStatusAction && !isSnoozeAction)) {
    return new Response("task_id and action are required", { status: 400 });
  }

  if (isStatusAction && !ALLOWED_ACTION_STATUS.includes(to)) {
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
  const actionKey = isStatusAction ? to : snoozeActionKey(snoozeDays);
  const sig = await createActionSignature(env.ACTION_SECRET, taskId, actionKey, exp);
  const destination = isStatusAction
    ? `現在: ${currentStatus} → 変更先: ${to}`
    : `Reminder Date → ${resolveSnoozeDate(snoozeDays)}（+${snoozeDays}日）`;

  const hiddenFields = isStatusAction
    ? `<input type="hidden" name="to" value="${to}">`
    : `<input type="hidden" name="snooze_days" value="${snoozeDays}">`;

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
    <p style="color:#555; margin:0 0 16px 0;">${destination}</p>
    <form method="POST" action="/action/task/update">
      <input type="hidden" name="task_id" value="${taskId}">
      ${hiddenFields}
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

export async function handleTaskUpdate(request, env) {
  if (!env.ACTION_SECRET) {
    return new Response("Missing ACTION_SECRET", { status: 500 });
  }

  const form = await request.formData();
  const taskId = String(form.get("task_id") || "").trim();
  const to = String(form.get("to") || "").trim();
  const snoozeDays = Number.parseInt(String(form.get("snooze_days") || ""), 10);
  const exp = String(form.get("exp") || "").trim();
  const sig = String(form.get("sig") || "").trim();
  const isStatusAction = !!to;
  const isSnoozeAction = !isStatusAction && ALLOWED_SNOOZE_DAYS.includes(snoozeDays);

  if (!taskId || !exp || !sig || (!isStatusAction && !isSnoozeAction)) {
    return new Response("invalid payload", { status: 400 });
  }

  if (isStatusAction && !ALLOWED_ACTION_STATUS.includes(to)) {
    return new Response("invalid status", { status: 400 });
  }

  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() > expNum) {
    return new Response("signature expired", { status: 403 });
  }

  const actionKey = isStatusAction ? to : snoozeActionKey(snoozeDays);
  const expected = await createActionSignature(env.ACTION_SECRET, taskId, actionKey, exp);
  if (!safeEqual(expected, sig)) {
    return new Response("invalid signature", { status: 403 });
  }

  try {
    if (isStatusAction) {
      await updateTaskStatus(env, taskId, to);
    } else {
      await updateTaskReminderDate(env, taskId, resolveSnoozeDate(snoozeDays));
    }
  } catch (error) {
    return new Response(error?.message || "Failed to update task", { status: 500 });
  }

  return new Response(
    "<html><body><p>更新しました。</p><script>window.close()</script></body></html>",
    { headers: { "Content-Type": "text/html; charset=UTF-8" } }
  );
}

export {
  ALLOWED_SNOOZE_DAYS,
  resolveSnoozeDate,
  snoozeActionKey
};
