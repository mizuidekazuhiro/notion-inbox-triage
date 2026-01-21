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

function calcElapsedDays(todayStart, sinceValue) {
  const sinceStart = parseJstDateStart(sinceValue);
  if (!sinceStart) return "-";
  return Math.floor((todayStart.getTime() - sinceStart.getTime()) / DAY_MS);
}

function formatSince(value) {
  if (!value) return "-";
  return value.slice(0, 10);
}

function buildActionLinks({ baseUrl, id, status }) {
  const targets = ["Do", "Thinking", "Waiting", "Done", "Drop", "Someday"].filter(
    (target) => target !== status
  );

  return targets
    .map((target) => {
      const href = `${baseUrl}/confirm?task_id=${encodeURIComponent(
        id
      )}&to=${encodeURIComponent(target)}`;
      return `
<a href="${href}" style="
  display:inline-block;
  margin: 6px 8px 0 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: #1a73e8;
  color: #fff;
  text-decoration: none;
  font-size: 14px;
">${target}</a>`;
    })
    .join("");
}

function buildSection({ title, items, sinceLabel, sinceKey, todayStart, baseUrl }) {
  if (items.length === 0) {
    return `
<h3 style="margin-top:24px;">${title}</h3>
<p style="color:#666;">該当タスクはありません。</p>
`;
  }

  return `
<h3 style="margin-top:24px;">${title}（${items.length} 件）</h3>
${items
  .map((item, index) => {
    const sinceValue = item[sinceKey];
    const elapsed = calcElapsedDays(todayStart, sinceValue);
    return `
<div style="
  border:1px solid #e0e0e0;
  border-radius:12px;
  background:#fff;
  padding:14px;
  margin:12px 0;
">
  <div style="font-weight:600; font-size:16px; margin-bottom:6px;">${index + 1}. ${
      item.name
    }</div>
  <div style="font-size:13px; color:#555; margin-bottom:8px;">
    Priority: ${item.priority} / ${sinceLabel}: ${formatSince(sinceValue)} / 経過: ${elapsed} 日
  </div>
  <div>${buildActionLinks({ baseUrl, id: item.id, status: item.status })}</div>
</div>
`;
  })
  .join("")}
`;
}

export function buildTasksDigestMail({
  doItems,
  somedayItems,
  baseUrl,
  weekStart,
  todayJstStr
}) {
  const todayStart = parseJstDateStart(todayJstStr) ?? startOfJstDay(new Date());

  const headerLines = [
    `今日: ${todayJstStr}`,
    `Do: ${doItems.length} 件`
  ];

  if (weekStart) {
    headerLines.push(`Someday: ${somedayItems.length} 件`);
  }

  return `
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
  <h2 style="margin-top:0;">🗂 Tasks Digest</h2>
  <p style="color:#555;">${headerLines.join(" / ")}</p>
  ${buildSection({
    title: "Do",
    items: doItems,
    sinceLabel: "Since Do",
    sinceKey: "sinceDoISO",
    todayStart,
    baseUrl
  })}
  ${
    weekStart
      ? buildSection({
          title: "Someday",
          items: somedayItems,
          sinceLabel: "Since Someday",
          sinceKey: "sinceSomedayISO",
          todayStart,
          baseUrl
        })
      : ""
  }
</body>
</html>
`;
}
