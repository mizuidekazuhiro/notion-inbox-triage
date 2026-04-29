import {
  DAY_MS,
  getJstDateParts,
  getJstDateString,
  isFirstBusinessDayOfWeek,
  parseJstDateStart,
  startOfJstDay
} from "./date.js";

function isWaitingReminderDue(item, todayStart) {
  if (!item.reminderDateISO) return false;
  const reminderStart = parseJstDateStart(item.reminderDateISO);
  if (!reminderStart) return false;
  return reminderStart.getTime() <= todayStart.getTime();
}

function isWaitingSinceDue(item, todayStart) {
  if (item.reminderDateISO) return false;
  const waitingStart = parseJstDateStart(item.waitingSinceISO);
  if (!waitingStart) return false;
  const elapsedDays = Math.floor(
    (todayStart.getTime() - waitingStart.getTime()) / DAY_MS
  );
  return elapsedDays >= 3;
}

function buildDoWaitingItems(items, todayStart) {
  return items
    .filter((item) => {
      if (item.status === "Do") return true;
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
  buildDoWaitingItems,
  getJstDateParts,
  getJstDateString,
  isFirstBusinessDayOfWeek,
  sortTasksBySince,
  startOfJstDay
};
