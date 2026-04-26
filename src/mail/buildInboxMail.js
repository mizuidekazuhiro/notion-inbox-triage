import { createMoveChooseSignature } from "../utils/signature";

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

export async function buildInboxMail(inboxItems, origin, actionSecret) {
  if (inboxItems.length === 0) {
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
      <h2 style="margin:0 0 8px; font-size:22px; line-height:1.4; color:#202124;">📥 Inbox (0 件)</h2>
      <p style="margin:0; color:#5f6368; font-size:15px; line-height:1.75;">本日の Inbox は空です 🎉</p>
    </div>
  </div>
</body>
</html>
`;
  }

  let body = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="${BODY_STYLE}">
  <div style="${WRAPPER_STYLE}">
    <div style="${PANEL_STYLE}">
      <h2 style="margin:0 0 8px; font-size:22px; line-height:1.4; color:#202124;">📥 Inbox (${inboxItems.length} 件)</h2>
      <p style="margin:0; color:#5f6368; font-size:14px; line-height:1.75;">
        本日時点で残っている Inbox 項目です。<br>
        各項目について、直感的に判断してください。
      </p>
    </div>
`;

  for (const [index, item] of inboxItems.entries()) {
    const sig =
      actionSecret && item.id
        ? await createMoveChooseSignature(actionSecret, item.id)
        : "";
    const chooseUrl = `${origin}/move/choose?inbox_page_id=${encodeURIComponent(item.id)}${
      sig ? `&sig=${encodeURIComponent(sig)}` : ""
    }`;
    body += `
    <div style="${CARD_STYLE}">
      <div style="font-weight:700; font-size:16px; line-height:1.6; margin:0 0 6px; color:#202124;">
        ${index + 1}. ${item.title}
      </div>

      <div style="font-size:13px; color:#5f6368; line-height:1.6; margin:0 0 10px;">
        作成日: ${item.created}
      </div>

      <a href="${chooseUrl}" style="
        display:inline-block;
        padding:8px 13px;
        border-radius:9px;
        background:#1a73e8;
        color:#ffffff;
        text-decoration:none;
        font-family:${EMAIL_FONT_STACK};
        font-size:14px;
        font-weight:600;
        line-height:1.35;
      ">▶ Move</a>
    </div>
`;
  }

  body += `
  </div>
</body>
</html>
`;

  return body;
}
