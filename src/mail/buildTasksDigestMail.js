import { DAY_MS, parseJstDateStart, startOfJstDay } from "../utils/date.js";

const EMAIL_FONT_STACK =
  "'Yu Gothic UI', 'Yu Gothic', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif";

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function calcElapsedDays(todayStart, value) {
  const start = parseJstDateStart(value);
  if (!start) return null;
  return Math.floor((todayStart.getTime() - start.getTime()) / DAY_MS);
}

function formatDateShort(value) {
  const date = parseJstDateStart(value);
  if (!date) return "-";
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.getUTCMonth() + 1}/${shifted.getUTCDate()}`;
}

function buildButton(href, label, secondary = false) {
  return `
<a href="${escapeHtml(href)}" style="
  display:inline-block;
  margin:8px 8px 0 0;
  padding:8px 13px;
  border-radius:9px;
  background:${secondary ? "#eef1f4" : "#1a73e8"};
  color:${secondary ? "#202124" : "#ffffff"};
  text-decoration:none;
  font-family:${EMAIL_FONT_STACK};
  font-size:14px;
  font-weight:600;
  line-height:1.35;
">${escapeHtml(label)}</a>`;
}

function statusHref(baseUrl, id, status) {
  return `${baseUrl}/confirm?task_id=${encodeURIComponent(id)}&to=${encodeURIComponent(status)}`;
}

function snoozeHref(baseUrl, id, days) {
  return `${baseUrl}/confirm?task_id=${encodeURIComponent(id)}&snooze_days=${days}`;
}

function buildDoActions({ baseUrl, item, comingUp = false }) {
  const actions = [
    buildButton(statusHref(baseUrl, item.id, "Done"), "Done")
  ];

  if (comingUp) {
    actions.push(buildButton(statusHref(baseUrl, item.id, "Waiting"), "Waiting", true));
    actions.push(buildButton(statusHref(baseUrl, item.id, "Someday"), "Someday", true));
  } else {
    actions.push(buildButton(snoozeHref(baseUrl, item.id, 1), "明日", true));
    actions.push(buildButton(snoozeHref(baseUrl, item.id, 3), "+3日", true));
    actions.push(buildButton(statusHref(baseUrl, item.id, "Waiting"), "Waiting", true));
  }

  return actions.join("");
}

function buildWaitingActions({ baseUrl, item }) {
  return [
    buildButton(statusHref(baseUrl, item.id, "Do"), "Doへ戻す"),
    buildButton(snoozeHref(baseUrl, item.id, 3), "+3日", true),
    buildButton(snoozeHref(baseUrl, item.id, 7), "+7日", true),
    buildButton(statusHref(baseUrl, item.id, "Done"), "Done", true)
  ].join("");
}

function parentContext(item) {
  if (!item.parentTaskName) return "";
  return `
  <div style="font-size:13px; color:#5f6368; line-height:1.6; margin:0 0 8px;">
    ↳ <strong>${escapeHtml(item.parentTaskName)}</strong>
  </div>`;
}

function priorityText(item) {
  return `<strong>${escapeHtml(item.priority || "-")}</strong>`;
}

function buildCard({ item, meta, actions }) {
  return `
<div style="${CARD_STYLE}">
  <div style="font-weight:700; font-size:16px; line-height:1.6; margin:0 0 4px; color:#202124;">
    ${escapeHtml(item.name)}
  </div>
  ${parentContext(item)}
  <div style="font-size:13px; color:#5f6368; line-height:1.65; margin:0 0 8px;">
    ${meta}
  </div>
  <div>${actions}</div>
</div>`;
}

function buildSection({ title, items, renderCard, emptyText = "該当タスクはありません。" }) {
  if (!items.length) {
    return `
<h3 style="margin:26px 0 8px; font-size:18px; line-height:1.45; color:#202124;">${escapeHtml(title)}｜0件</h3>
<p style="margin:0 0 12px; color:#5f6368; font-size:14px; line-height:1.7;">${escapeHtml(emptyText)}</p>`;
  }

  return `
<h3 style="margin:26px 0 10px; font-size:18px; line-height:1.45; color:#202124;">${escapeHtml(title)}｜${items.length}件</h3>
${items.map(renderCard).join("")}`;
}

function actionNowMeta(item, todayStart) {
  const overdue = Math.max(calcElapsedDays(todayStart, item.dueDateISO) ?? 0, 0);
  const state = overdue === 0 ? "今日" : `<strong>${overdue}日超過</strong>`;
  return `${priorityText(item)} ｜ Due ${formatDateShort(item.dueDateISO)} ｜ ${state}`;
}

function longOverdueMeta(item, todayStart) {
  const overdue = Math.max(calcElapsedDays(todayStart, item.dueDateISO) ?? 0, 0);
  const inDo = Math.max(calcElapsedDays(todayStart, item.sinceDoISO) ?? 0, 0);
  const state =
    overdue >= 14
      ? `<strong>${overdue}日超過</strong>`
      : `<strong>${inDo}日間 Do</strong>`;
  return `${priorityText(item)} ｜ Due ${formatDateShort(item.dueDateISO)} ｜ ${state}`;
}

function followUpMeta(item, todayStart) {
  const waitingDays = calcElapsedDays(todayStart, item.waitingSinceISO);
  const parts = [];

  if (item.priority && item.priority !== "-") parts.push(priorityText(item));

  if (item.waitingSinceISO) {
    parts.push(`Waiting since ${formatDateShort(item.waitingSinceISO)}`);
    if (waitingDays !== null) {
      parts.push(`<strong>${Math.max(waitingDays, 0)}日待ち</strong>`);
    }
  } else if (item.reminderDateISO) {
    parts.push(`Reminder ${formatDateShort(item.reminderDateISO)}`);
  }

  if (item.dueDateISO) parts.push(`Due ${formatDateShort(item.dueDateISO)}`);
  return parts.join(" ｜ ");
}

function comingUpMeta(item) {
  return `${priorityText(item)} ｜ Due ${formatDateShort(item.dueDateISO)}`;
}

function needsSetupMeta(item) {
  const parts = [];
  if (item.priority && item.priority !== "-") parts.push(priorityText(item));
  if (item.setupReason) parts.push(escapeHtml(item.setupReason));
  return parts.join(" ｜ ") || "設定を確認してください";
}

function buildSomedaySection({ items, todayStart, baseUrl }) {
  if (!items.length) return "";

  return buildSection({
    title: "🧹 Weekly Someday Review",
    items,
    renderCard: (item) => {
      const days = calcElapsedDays(todayStart, item.sinceSomedayISO);
      const meta = `${priorityText(item)} ｜ Since Someday ${formatDateShort(item.sinceSomedayISO)}${
        days === null ? "" : ` ｜ ${Math.max(days, 0)}日`
      }`;

      return buildCard({
        item,
        meta,
        actions: [
          buildButton(statusHref(baseUrl, item.id, "Do"), "Do"),
          buildButton(statusHref(baseUrl, item.id, "Thinking"), "Thinking", true),
          buildButton(statusHref(baseUrl, item.id, "Drop"), "Drop", true)
        ].join("")
      });
    }
  });
}

export function buildTasksDigestMail({
  actionNow,
  longOverdue,
  followUp,
  comingUp,
  needsSetup,
  somedayItems,
  baseUrl,
  weekStart,
  todayJstStr
}) {
  const todayStart = parseJstDateStart(todayJstStr) ?? startOfJstDay(new Date());
  const configuredDoCount = actionNow.length + longOverdue.length + comingUp.length;

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
      <h2 style="margin:0 0 8px; font-size:22px; line-height:1.4; color:#202124; letter-spacing:0.01em;">🗂 Tasks Digest — ${escapeHtml(todayJstStr)}</h2>
      <p style="margin:0; color:#5f6368; font-size:14px; line-height:1.7;">
        親タスクは一覧から除外し、子タスクには関連する親タスク名を補足表示しています。
      </p>
    </div>

    ${buildSection({
      title: "🔴 Action Now",
      items: actionNow,
      renderCard: (item) =>
        buildCard({
          item,
          meta: actionNowMeta(item, todayStart),
          actions: buildDoActions({ baseUrl, item })
        })
    })}

    ${buildSection({
      title: "🔴 Long Overdue",
      items: longOverdue,
      renderCard: (item) =>
        buildCard({
          item,
          meta: longOverdueMeta(item, todayStart),
          actions: buildDoActions({ baseUrl, item })
        })
    })}

    ${buildSection({
      title: "🟠 Follow-up",
      items: followUp,
      renderCard: (item) =>
        buildCard({
          item,
          meta: followUpMeta(item, todayStart),
          actions: buildWaitingActions({ baseUrl, item })
        })
    })}

    ${buildSection({
      title: "📅 Coming Up",
      items: comingUp,
      renderCard: (item) =>
        buildCard({
          item,
          meta: comingUpMeta(item),
          actions: buildDoActions({ baseUrl, item, comingUp: true })
        })
    })}

    ${buildSection({
      title: "⚠️ Needs Setup",
      items: needsSetup,
      renderCard: (item) =>
        buildCard({
          item,
          meta: needsSetupMeta(item),
          actions: item.url ? buildButton(item.url, "確認する") : ""
        })
    })}

    ${weekStart ? buildSomedaySection({ items: somedayItems, todayStart, baseUrl }) : ""}

    <div style="${PANEL_STYLE}; margin-top:24px;">
      <p style="margin:0; color:#5f6368; font-size:14px; line-height:1.7;">
        <strong>Do ${configuredDoCount}</strong> ｜ Waiting ${followUp.length} ｜ Coming Up ${comingUp.length} ｜ Needs Setup ${needsSetup.length}
      </p>
    </div>
  </div>
</body>
</html>`;
}

export {
  calcElapsedDays,
  formatDateShort,
  longOverdueMeta
};
