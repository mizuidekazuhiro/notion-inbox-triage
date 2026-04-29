import { queryDoWaitingTasks, queryTasksByStatus } from "../notion/tasks.js";
import { buildTasksDigestMail } from "../mail/buildTasksDigestMail.js";
import {
  buildDoWaitingItems,
  getJstDateString,
  isFirstBusinessDayOfWeek,
  sortTasksBySince,
  startOfJstDay
} from "../utils/tasksDigest.js";

export async function buildTasksDigestData({ env, baseUrl }) {
  const todayStart = startOfJstDay(new Date());
  const todayJstStr = getJstDateString(todayStart);
  const holidays = await fetchHolidaysJson();
  const weekStart = isFirstBusinessDayOfWeek(todayStart, holidays);

  const doWaitingItems = sortTasksBySince(
    buildDoWaitingItems(await queryDoWaitingTasks(env), todayStart),
    "digestSinceISO"
  );

  const somedayItems = weekStart
    ? sortTasksBySince(await queryTasksByStatus(env, "Someday"), "sinceSomedayISO")
    : [];

  const subject = weekStart
    ? `Tasks｜Do/Waiting ${doWaitingItems.length}件 / Someday ${somedayItems.length}件`
    : `Tasks｜Do/Waiting ${doWaitingItems.length}件`;

  const body = buildTasksDigestMail({
    doWaitingItems,
    somedayItems,
    baseUrl,
    weekStart,
    todayJstStr
  });

  return {
    subject,
    body,
    week_start: weekStart,
    count_do: doWaitingItems.length,
    count_do_waiting: doWaitingItems.length,
    count_someday: somedayItems.length,
    today_jst: todayJstStr
  };
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
