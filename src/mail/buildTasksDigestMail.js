const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const EMAIL_FONT_STACK =
  '"Yu Gothic UI", "Yu Gothic", "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, "Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif';

const BODY_STYLE = `
  margin:0;
  padding:0;
  background:#f4f5f7;
  color:#202124;
  font-family:${EMAIL_FONT_STACK};
  font-size:15px;
  line-height:1.75;
  letter-spacing:0.01em;
  -webkit-text-size-adjust:100%;
  text-size-adjust:100%;
`;

const WRAPPER_STYLE = `
  max-width:680px;
  margin:0 auto;
  padding:20px 14px 28px;
`;

const PANEL_STYLE = `
  background:#ffffff;
  border:1px solid #e6e8eb;
  border-radius:16px;
  padding:18px;
  box-shadow:0 1px 2px rgba(0,0,0,0.04);
`;

const CARD_STYLE = `
  border:1px solid #e6e8eb;
  border-radius:14px;
  background:#ffffff;
  padding:16px;
  margin:12px 0;
`;

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
  margin:8px 8px 0 0;
  padding:8px 13px;
  border-radius:9px;
  background:#1a73e8;
  color:#ffffff;
  text-decoration:none;
  font-family:${EMAIL_FONT_STACK};
  font-size:14px;
  font-weight:600;
  line-height:1.35;
">${target}</a>`;
    })
    .join("");
}

function buildSection({
  title,
  items,
  getSinceLabel,
  getSinceValue,
  todayStart,
  baseUrl
}) {
  if (items.length === 0) {
    return `
<h3 style="margin:26px 0 8px; font-size:18px; line-height:1.45; color:#202124;">${title}</h3>
<p style="margin:0 0 12px; color:#5f6368; font-size:14px; line-height:1.7;">該当タスクはありません。</p>
`;
  }

  return `
<h3 style="margin:26px 0 10px; font-size:18px; line-height:1.45; color:#202124;">${title}（${items.length} 件）</h3>
${items
  .map((item, index) => {
    const sinceValue = getSinceValue(item);
    const sinceLabel = getSinceLabel(item);
    const elapsed = calcElapsedDays(todayStart, sinceValue);
    return `
<div style="${CARD_STYLE}">
  <div style="font-weight:700; font-size:16px; line-height:1.6; margin:0 0 6px; color:#202124;">${index + 1}. ${
      item.name
    }</div>
  <div style="font-size:13px; color:#5f6368; line-height:1.6; margin:0 0 10px;">
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
  doWaitingItems,
  somedayItems,
  baseUrl,
  weekStart,
  todayJstStr
}) {
  const todayStart = parseJstDateStart(todayJstStr) ?? startOfJstDay(new Date());

  const headerLines = [
    `今日: ${todayJstStr}`,
    `Do/Waiting: ${doWaitingItems.length} 件`
  ];

  if (weekStart) {
    headerLines.push(`Someday: ${somedayItems.length} 件`);
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="${BODY_STYLE}">
  <div style="${WRAPPER_STYLE}">
    <div style="${PANEL_STYLE}">
      <h2 style="margin:0 0 8px; font-size:22px; line-height:1.4; color:#202124; letter-spacing:0.01em;">🗂 Tasks Digest</h2>
      <p style="margin:0; color:#5f6368; font-size:14px; line-height:1.7;">${headerLines.join(" / ")}</p>
    </div>
    ${buildSection({
      title: "Do/Waiting",
      items: doWaitingItems,
      getSinceLabel: (item) => item.digestSinceLabel || "Since",
      getSinceValue: (item) => item.digestSinceISO || "",
      todayStart,
      baseUrl
    })}
    ${
      weekStart
        ? buildSection({
            title: "Someday",
            items: somedayItems,
            getSinceLabel: () => "Since Someday",
            getSinceValue: (item) => item.sinceSomedayISO || "",
            todayStart,
            baseUrl
          })
        : ""
    }
  </div>
</body>
</html>
`;
}
