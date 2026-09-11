import { queryDoWaitingTasks, queryTasksByStatus } from "../notion/tasks.js";
import { buildTasksDigestMail } from "../mail/buildTasksDigestMail.js";
import {
  classifyTasksForDigest,
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

  const digest = classifyTasksForDigest(
    await queryDoWaitingTasks(env),
    todayStart
  );

  const somedayItems = weekStart
    ? sortTasksBySince(await queryTasksByStatus(env, "Someday"), "sinceSomedayISO")
    : [];

  const configuredDoCount =
    digest.actionNow.length + digest.longOverdue.length + digest.comingUp.length;
  const followUpCount = digest.followUp.length;

  const subject = `Tasks｜Do ${configuredDoCount}件 / Follow-up ${followUpCount}件`;

  const body = buildTasksDigestMail({
    ...digest,
    somedayItems,
    baseUrl,
    weekStart,
    todayJstStr
  });

  return {
    subject,
    body,
    week_start: weekStart,
    count_do: configuredDoCount,
    count_do_waiting: configuredDoCount + followUpCount,
    count_follow_up: followUpCount,
    count_long_overdue: digest.longOverdue.length,
    count_coming_up: digest.comingUp.length,
    count_needs_setup: digest.needsSetup.length,
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
