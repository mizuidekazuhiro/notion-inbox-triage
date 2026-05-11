import { queryWidgetTasksToday } from "../notion/tasks.js";
import { jsonResponse } from "../utils/http.js";
import { DAY_MS, parseJstDateStart, startOfJstDay, getJstDateString } from "../utils/date.js";

function parseWidgetLimit(request) {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") || "10", 10);
  if (!Number.isFinite(raw) || raw <= 0) return 10;
  return Math.min(raw, 50);
}

function isWaitingDue(item, todayStart) {
  if (item.reminderDateISO) {
    const reminderStart = parseJstDateStart(item.reminderDateISO);
    return !!reminderStart && reminderStart.getTime() <= todayStart.getTime();
  }

  const waitingStart = parseJstDateStart(item.waitingSinceISO);
  if (!waitingStart) return false;
  const elapsedDays = Math.floor((todayStart.getTime() - waitingStart.getTime()) / DAY_MS);
  return elapsedDays >= 3;
}

function toWidgetTaskItem(item) {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    priority: item.priority || "-",
    due_date: (() => {
      const dueStart = parseJstDateStart(item.dueDateISO);
      return dueStart ? getJstDateString(dueStart) : null;
    })(),
    summary: item.summary || "",
    my_tasks: item.myTasks || "",
    other_tasks: item.otherTasks || "",
    url: item.url || ""
  };
}

function sortByDueDateAsc(items) {
  return [...items].sort((a, b) => {
    const aDue = parseJstDateStart(a.dueDateISO);
    const bDue = parseJstDateStart(b.dueDateISO);
    if (!aDue && !bDue) return 0;
    if (!aDue) return 1;
    if (!bDue) return -1;
    return aDue.getTime() - bDue.getTime();
  });
}

export async function handleWidgetTasksToday(request, env) {
  const limit = parseWidgetLimit(request);

  if (!env.SHORTCUT_TOKEN) {
    console.log(JSON.stringify({ event: "widget_tasks_today_request", success: false, limit, count: 0, error: "shortcut_token_missing" }));
    return jsonResponse({ ok: false, error: "shortcut_token_missing" }, 500);
  }

  const token = request.headers.get("X-Shortcut-Token");
  if (!token || token !== env.SHORTCUT_TOKEN) {
    console.log(JSON.stringify({ event: "widget_tasks_today_request", success: false, limit, count: 0, error: "unauthorized" }));
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const todayStart = startOfJstDay(new Date());
    const items = await queryWidgetTasksToday(env, 100);
    const filtered = items.filter((item) => item.status === "Do" || (item.status === "Waiting" && isWaitingDue(item, todayStart)));
    const sorted = sortByDueDateAsc(filtered);
    const limited = sorted.slice(0, limit).map(toWidgetTaskItem);
    console.log(JSON.stringify({ event: "widget_tasks_today_request", success: true, limit, count: filtered.length }));
    return jsonResponse({ ok: true, count: filtered.length, items: limited });
  } catch (error) {
    console.log(JSON.stringify({ event: "widget_tasks_today_request", success: false, limit, count: 0, error: error?.message || "notion_error" }));
    return jsonResponse({ ok: false, error: "notion_error" }, 502);
  }
}

export { parseWidgetLimit, sortByDueDateAsc, isWaitingDue };
