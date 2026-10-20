import { DAY_MS, getJstDateString, startOfJstDay } from "../utils/date.js";
import { jsonResponse } from "../utils/http.js";

const EVENT_DATE_PROPERTY = "Event Date";
const LOOKBACK_DAYS = 31;
const MAX_QUERY_PAGES = 20;

function parseScheduleLimit(request) {
  const n = Number(new URL(request.url).searchParams.get("limit"));
  return Number.isInteger(n) && n > 0 ? Math.min(n, 20) : 10;
}
function eventTimeMs(value) {
  if (!value || typeof value !== "string") return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00+09:00`);
  return Date.parse(value);
}
function eventEndMs(date) {
  const value = date.end || date.start;
  const end = eventTimeMs(value);
  if (!Number.isFinite(end)) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return end + DAY_MS;
  return date.end ? end : end + 1;
}
function selectUpcomingEvents(pages, now, windowEnd) {
  const seen = new Set();
  return pages.flatMap(page => {
    if (page.id && seen.has(page.id)) return [];
    if (page.id) seen.add(page.id);
    if (page.archived || page.in_trash || page.properties?.Status?.select?.name === "Drop" ||
        page.properties?.Status?.status?.name === "Drop") return [];
    const date = page.properties?.[EVENT_DATE_PROPERTY]?.date;
    if (!date?.start) return [];
    const startMs = eventTimeMs(date.start), endMs = eventEndMs(date);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= windowEnd || endMs <= now) return [];
    const title = (page.properties?.["名前"]?.title || [])
      .map(t => t.plain_text || t.text?.content || "").join("") || "無題の予定";
    return [{
      id: page.id, title, start: date.start, end: date.end || null,
      all_day: /^\d{4}-\d{2}-\d{2}$/.test(date.start),
      url: page.url || "", _startMs: startMs
    }];
  }).sort((a,b) => a._startMs - b._startMs || a.title.localeCompare(b.title,"ja"))
    .map(({_startMs, ...item}) => item);
}
async function queryEventDatePages(env, fromDate, untilExclusive) {
  const pages = [];
  let cursor;
  for (let n = 0; n < MAX_QUERY_PAGES; n++) {
    const query = {
      page_size: 100,
      filter: {and: [
        ...(fromDate ? [{property: EVENT_DATE_PROPERTY, date: {on_or_after: fromDate}}] : []),
        {property: EVENT_DATE_PROPERTY, date: {before: untilExclusive}}
      ]},
      sorts: [{property: EVENT_DATE_PROPERTY, direction: "ascending"}]
    };
    if (cursor) query.start_cursor = cursor;
    const response = await fetch(`https://api.notion.com/v1/databases/${env.TASKS_DB_ID}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(query)
    });
    if (!response.ok) throw new Error(`notion_query_http_${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.results)) throw new Error("notion_response_invalid");
    pages.push(...body.results);
    if (!body.has_more) return pages;
    if (!body.next_cursor || cursor === body.next_cursor) throw new Error("notion_cursor_invalid");
    cursor = body.next_cursor;
  }
  throw new Error("notion_result_limit_exceeded");
}
export async function handleWidgetScheduleWeek(request, env) {
  if (!env.SHORTCUT_TOKEN || !env.TASKS_DB_ID || !env.NOTION_TOKEN)
    return jsonResponse({ok:false,error:"widget_configuration_missing"},500);
  if (request.headers.get("X-Shortcut-Token") !== env.SHORTCUT_TOKEN)
    return jsonResponse({ok:false,error:"unauthorized"},401);

  const now = Date.now(), today = startOfJstDay(new Date(now)).getTime();
  const until = today + 7 * DAY_MS;
  const fromDate = getJstDateString(new Date(today - LOOKBACK_DAYS * DAY_MS));
  const untilExclusive = getJstDateString(new Date(until));
  try {
    const pages = await queryEventDatePages(env,fromDate,untilExclusive);
    const items = selectUpcomingEvents(pages,now,until);
    return jsonResponse({
      ok:true, timezone:"Asia/Tokyo", from:getJstDateString(new Date(today)),
      until_exclusive:untilExclusive, count:items.length,
      items:items.slice(0,parseScheduleLimit(request))
    });
  } catch (e) {
    console.error("widget_schedule_week_failed", e?.message || "unknown_error");
    return jsonResponse({ok:false,error:"schedule_query_failed"},502);
  }
}
export {parseScheduleLimit,eventTimeMs,eventEndMs,selectUpcomingEvents,queryEventDatePages};

