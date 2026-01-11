export function buildInboxMail(inboxItems, origin) {
  if (inboxItems.length === 0) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  background: #f7f7f7;
  padding: 16px;
">
  <h2>📥 Inbox (0 件)</h2>
  <p>本日の Inbox は空です 🎉</p>
</body>
</html>
`;
  }

  let body = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  background: #f7f7f7;
  padding: 16px;
">

<h2>📥 Inbox (${inboxItems.length} 件)</h2>

<p style="color:#555;">
本日時点で残っている Inbox 項目です。<br>
各項目について、直感的に判断してください。
</p>
`;

  inboxItems.forEach((item, index) => {
    body += `
<div style="
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  background: #fff;
">
  <div style="font-weight: bold; margin-bottom: 6px;">
    ${index + 1}. ${item.title}
  </div>

  <div style="font-size: 12px; color: #666; margin-bottom: 10px;">
    作成日: ${item.created}
  </div>

  <a href="${origin}/action/move?id=${item.id}&status=Do">▶ Do</a> /
  <a href="${origin}/action/move?id=${item.id}&status=Someday">▶ Someday</a> /
  <a href="${origin}/action/move?id=${item.id}&status=Drop">▶ Drop</a>
</div>
`;
  });

  body += `
</body>
</html>
`;

  return body;
}