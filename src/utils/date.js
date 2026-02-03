const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

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
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day) - JST_OFFSET_MS);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return startOfJstDay(date);
}

function normalizeJstDateString(value) {
  const dateStart = parseJstDateStart(value);
  if (!dateStart) return null;
  return getJstDateString(dateStart);
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

export {
  DAY_MS,
  JST_OFFSET_MS,
  toJstDate,
  startOfJstDay,
  getJstDateParts,
  getJstDateString,
  parseJstDateStart,
  normalizeJstDateString,
  isBusinessDay,
  isFirstBusinessDayOfWeek
};
