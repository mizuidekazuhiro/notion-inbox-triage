import {
  DAY_MS,
  getJstDateParts,
  getJstDateString,
  isFirstBusinessDayOfWeek,
  parseJstDateStart,
  startOfJstDay
} from "./date.js";

const LONG_OVERDUE_DAYS = 14;
const PRIORITY_RANK = Object.freeze({ High: 0, Mid: 1, Low: 2, "-": 3 });

function elapsedDays(todayStart, value) {
  const start = parseJstDateStart(value);
  if (!start) return null;
  return Math.floor((todayStart.getTime() - start.getTime()) / DAY_MS);
}

function isReminderDue(item, todayStart) {
  if (!item.reminderDateISO) return false;
  const reminderStart = parseJstDateStart(item.reminderDateISO);
  return !!reminderStart && reminderStart.getTime() <= todayStart.getTime();
}

function isReminderFuture(item, todayStart) {
  if (!item.reminderDateISO) return false;
  const reminderStart = parseJstDateStart(item.reminderDateISO);
  return !!reminderStart && reminderStart.getTime() > todayStart.getTime();
}

function isWaitingReminderDue(item, todayStart) {
  return isReminderDue(item, todayStart);
}

function isWaitingSinceDue(item, todayStart) {
  if (item.reminderDateISO) return false;
  const days = elapsedDays(todayStart, item.waitingSinceISO);
  return days !== null && days >= 3;
}

function isParentTask(item) {
  return item.taskLevel === "親タスク";
}

function buildDoWaitingItems(items, todayStart) {
  return items
    .filter((item) => {
      if (isParentTask(item)) return false;
      if (item.status === "Do") return !isReminderFuture(item, todayStart);
      if (item.status !== "Waiting") return false;
      return isWaitingReminderDue(item, todayStart) || isWaitingSinceDue(item, todayStart);
    })
    .map((item) => {
      if (item.status === "Waiting") {
        const waitingSinceISO = item.waitingSinceISO || "";
        const reminderDateISO = item.reminderDateISO || "";
        const digestSinceISO = waitingSinceISO || reminderDateISO;
        const digestSinceLabel = waitingSinceISO ? "Waiting since" : "Reminder";
        return {
          ...item,
          digestSinceISO,
          digestSinceLabel
        };
      }
      return {
        ...item,
        digestSinceISO: item.sinceDoISO || "",
        digestSinceLabel: "Since Do"
      };
    });
}

function priorityRank(item) {
  return PRIORITY_RANK[item.priority] ?? 4;
}

function compareName(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""), "ja");
}

function comparePriority(a, b) {
  return priorityRank(a) - priorityRank(b);
}

function compareDateAsc(aValue, bValue) {
  const aDate = parseJstDateStart(aValue);
  const bDate = parseJstDateStart(bValue);
  if (!aDate && !bDate) return 0;
  if (!aDate) return 1;
  if (!bDate) return -1;
  return aDate.getTime() - bDate.getTime();
}

function doStaleDays(item, todayStart) {
  const dueDays = elapsedDays(todayStart, item.dueDateISO);
  const doDays = elapsedDays(todayStart, item.sinceDoISO);
  return Math.max(dueDays ?? -1, doDays ?? -1, 0);
}

function sortActionNow(items) {
  return [...items].sort(
    (a, b) =>
      comparePriority(a, b) ||
      compareDateAsc(a.dueDateISO, b.dueDateISO) ||
      compareName(a, b)
  );
}

function sortLongOverdue(items, todayStart) {
  return [...items].sort(
    (a, b) =>
      doStaleDays(b, todayStart) - doStaleDays(a, todayStart) ||
      comparePriority(a, b) ||
      compareDateAsc(a.dueDateISO, b.dueDateISO) ||
      compareName(a, b)
  );
}

function sortFollowUp(items, todayStart) {
  return [...items].sort((a, b) => {
    const aWait = elapsedDays(todayStart, a.waitingSinceISO) ?? -1;
    const bWait = elapsedDays(todayStart, b.waitingSinceISO) ?? -1;
    return (
      comparePriority(a, b) ||
      bWait - aWait ||
      compareDateAsc(a.reminderDateISO, b.reminderDateISO) ||
      compareName(a, b)
    );
  });
}

function sortComingUp(items) {
  return [...items].sort(
    (a, b) =>
      compareDateAsc(a.dueDateISO, b.dueDateISO) ||
      comparePriority(a, b) ||
      compareName(a, b)
  );
}

function sortNeedsSetup(items) {
  return [...items].sort((a, b) => comparePriority(a, b) || compareName(a, b));
}

function classifyTasksForDigest(items, todayStart, longOverdueDays = LONG_OVERDUE_DAYS) {
  const actionNow = [];
  const longOverdue = [];
  const followUp = [];
  const comingUp = [];
  const needsSetup = [];

  for (const item of items) {
    if (isParentTask(item)) continue;

    if (item.status === "Waiting") {
      if (isReminderFuture(item, todayStart)) continue;

      if (isWaitingReminderDue(item, todayStart) || isWaitingSinceDue(item, todayStart)) {
        followUp.push(item);
      } else if (!item.reminderDateISO && !item.waitingSinceISO) {
        needsSetup.push({
          ...item,
          setupReason: "Reminder Date / Waiting Since 未設定"
        });
      }
      continue;
    }

    if (item.status !== "Do") continue;
    if (isReminderFuture(item, todayStart)) continue;

    const dueStart = parseJstDateStart(item.dueDateISO);
    if (!dueStart) {
      needsSetup.push({
        ...item,
        setupReason: "Due Date 未設定"
      });
      continue;
    }

    if (dueStart.getTime() > todayStart.getTime()) {
      comingUp.push(item);
      continue;
    }

    const overdueDays = elapsedDays(todayStart, item.dueDateISO) ?? 0;
    const inDoDays = elapsedDays(todayStart, item.sinceDoISO) ?? 0;
    if (overdueDays >= longOverdueDays || inDoDays >= longOverdueDays) {
      longOverdue.push(item);
    } else {
      actionNow.push(item);
    }
  }

  return {
    actionNow: sortActionNow(actionNow),
    longOverdue: sortLongOverdue(longOverdue, todayStart),
    followUp: sortFollowUp(followUp, todayStart),
    comingUp: sortComingUp(comingUp),
    needsSetup: sortNeedsSetup(needsSetup)
  };
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

export {
  LONG_OVERDUE_DAYS,
  buildDoWaitingItems,
  classifyTasksForDigest,
  elapsedDays,
  getJstDateParts,
  getJstDateString,
  isFirstBusinessDayOfWeek,
  isParentTask,
  isReminderFuture,
  isWaitingReminderDue,
  isWaitingSinceDue,
  sortTasksBySince,
  startOfJstDay
};
