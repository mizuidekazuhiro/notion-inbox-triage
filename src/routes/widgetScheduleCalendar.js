import { DAY_MS, getJstDateString, startOfJstDay } from "../utils/date.js";
import { jsonResponse } from "../utils/http.js";
import { queryEventDatePages, selectUpcomingEvents } from "./widgetScheduleWeek.js";

export function calendarWindow(now = new Date()) {
  const today = startOfJstDay(now).getTime();
  const weekday = new Date(today + 9 * 3600000).getUTCDay();
  const start = today - weekday * DAY_MS;
  const end = start + 28 * DAY_MS;
  return { start, end, from: getJstDateString(new Date(start)),
    until_exclusive: getJstDateString(new Date(end)) };
}

export async function handleWidgetScheduleCalendar(request, env) {
  if (!env.SHORTCUT_TOKEN || !env.TASKS_DB_ID || !env.NOTION_TOKEN)
    return jsonResponse({ ok: false, error: "widget_configuration_missing" }, 500);
  if (request.headers.get("X-Shortcut-Token") !== env.SHORTCUT_TOKEN)
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  if (request.method !== "GET")
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  const range = calendarWindow();
  try {
    // No lower bound on starts: even an event beginning months ago can overlap
    // this window. Filter precise overlap locally. Pagination must finish; the
    // shared query throws rather than silently returning an incomplete calendar.
    const pages = await queryEventDatePages(env, null, range.until_exclusive);
    const items = selectUpcomingEvents(pages, range.start, range.end);
    return jsonResponse({ ok: true, timezone: "Asia/Tokyo", weeks: 4,
      week_starts_on: "sunday", from: range.from,
      until_exclusive: range.until_exclusive, count: items.length,
      generated_at: new Date().toISOString(), items });
  } catch (_) {
    return jsonResponse({ ok: false, error: "schedule_query_failed" }, 502);
  }
}
