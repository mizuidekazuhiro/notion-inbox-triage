// Scriptable (iOS) — Notion Event Date, today's next 7 calendar days.
// Security: put the existing Worker X-Shortcut-Token in iOS Keychain.
const API_URL = "https://notion-inbox-triage.kazuhiro-mizuide.workers.dev/api/widget/schedule/week?limit=20";
const TOKEN_KEY = "NOTION_WEEK_WIDGET_SHORTCUT_TOKEN";
const NOTION_HOME_URL = "https://www.notion.so/3d6dec27c9aa81d08065df5c1a1b9f76";
const TIME_ZONE = "Asia/Tokyo";

async function tokenFromKeychain() {
  if (Keychain.contains(TOKEN_KEY)) return Keychain.get(TOKEN_KEY);
  if (config.runsInWidget) return null;
  const dialog = new Alert();
  dialog.title = "Notion予定ウィジェット";
  dialog.message = "既存のScriptableの X-Shortcut-Token を入力してください。Notion APIトークンではありません。端末内のKeychainに保存します。";
  dialog.addSecureTextField("X-Shortcut-Token", "");
  dialog.addAction("保存");
  dialog.addCancelAction("キャンセル");
  const selected = await dialog.presentAlert();
  if (selected !== 0) return null;
  const token = dialog.textFieldValue(0).trim();
  if (!token) return null;
  Keychain.set(TOKEN_KEY, token);
  return token;
}
function formatDate(value) {
  const date = value.length === 10 ? new Date(`${value}T00:00:00+09:00`) : new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIME_ZONE, month: "numeric", day: "numeric", weekday: "short"
  }).format(date);
}
function formatTime(item) {
  if (item.all_day) return "終日";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(item.start));
}
function addLabel(parent, text, size, color, font) {
  const label = parent.addText(text);
  label.font = font || Font.systemFont(size);
  label.textColor = color;
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.74;
  return label;
}
function makeWidget(result, error) {
  const widget = new ListWidget();
  const gradient = new LinearGradient();
  gradient.colors = [new Color("#101820", 0.90), new Color("#143039", 0.88)];
  gradient.locations = [0, 1];
  widget.backgroundGradient = gradient;
  widget.setPadding(13, 14, 12, 14);
  widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  widget.url = NOTION_HOME_URL;

  const family = config.widgetFamily || "large";
  const visible = family === "small" ? 2 : family === "medium" ? 3 : 7;
  const header = widget.addStack();
  header.centerAlignContent();
  addLabel(header, "NEXT 7 DAYS", 11, new Color("#9ABAD1"), Font.semiboldSystemFont(11));
  header.addSpacer();
  if (result?.count !== undefined) addLabel(header, `${result.count}件`, 11, new Color("#DFE7F2"));
  widget.addSpacer(9);

  if (error) {
    addLabel(widget, error, 12, new Color("#F6D4D4"));
    widget.addSpacer();
    return widget;
  }
  if (!result?.items?.length) {
    addLabel(widget, "今後7日間の予定はありません", 12, new Color("#F2F4F8"));
    widget.addSpacer();
    return widget;
  }
  const items = result.items.slice(0, visible);
  for (const item of items) {
    const row = widget.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    if (item.url) row.url = item.url;
    const when = row.addStack();
    when.layoutVertically();
    when.size = new Size(family === "small" ? 64 : 82, 30);
    addLabel(when, formatDate(item.start), 10, new Color("#ABD3DD"), Font.mediumSystemFont(10));
    addLabel(when, formatTime(item), 10, new Color("#A9B6C3"));
    row.addSpacer(6);
    addLabel(row, item.title, family === "small" ? 11 : 12, new Color("#FFFFFF"), Font.mediumSystemFont(12));
    widget.addSpacer(family === "large" ? 9 : 8);
  }
  if (result.count > items.length) {
    addLabel(widget, `ほか ${result.count - items.length} 件（タップしてNotionへ）`, 10, new Color("#A5B8C5"));
  }
  widget.addSpacer();
  return widget;
}
let result = null;
let error = null;
try {
  const token = await tokenFromKeychain();
  if (!token) {
    error = "Scriptableから実行して認証設定";
  } else {
    const request = new Request(API_URL);
    request.method = "GET";
    request.headers = {"X-Shortcut-Token": token};
    request.timeoutInterval = 15;
    result = await request.loadJSON();
    if (!result.ok || !Array.isArray(result.items)) {
      error = result.error === "unauthorized" ? "認証キーを確認してください" : "予定データを取得できません";
    }
  }
} catch (_) {
  error = "通信できません。少し待って再試行";
}
const widget = makeWidget(result, error);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentLarge();
Script.complete();
