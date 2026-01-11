export function buildInboxMail(inboxItems, origin) {
  // Inbox が空の場合
  if (!inboxItems || inboxItems.length === 0) {
    return `
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
          <h2>📥 Inbox</h2>
          <p>本日の Inbox は空です 🎉</p>
        </body>
      </html>
    `;
  }

  const itemsHtml = inboxItems
    .map((item, index) => {
      return `
        <div style="
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 12px;
        ">
          <div style="font-weight: bold; margin-bottom: 6px;">
            ${index + 1}. ${item.title}
          </div>

          <div style="font-size: 12px; color: #666; margin-bottom: 10px;">
            作成日: ${item.created}
          </div>

          <div>
            <a href="${origin}/action/move?id=${item.id}&status=Do"
               style="
                 display: inline-block;
                 padding: 6px 12px;
                 margin-right: 6px;
                 background: #007aff;
                 color: white;
                 text-decoration: none;
                 border-radius: 6px;
                 font-size: 13px;
               ">
              Do
            </a>

            <a href="${origin}/action/move?id=${item.id}&status=Someday"
               style="
                 display: inline-block;
                 padding: 6px 12px;
                 margin-right: 6px;
                 background: #8e8e93;
                 color: white;
                 text-decoration: none;
                 border-radius: 6px;
                 font-size: 13px;
               ">
              Someday
            </a>

            <a href="${origin}/action/move?id=${item.id}&status=Drop"
               style="
                 display: inline-block;
                 padding: 6px 12px;
                 background: #ff3b30;
                 color: white;
                 text-decoration: none;
                 border-radius: 6px;
                 font-size: 13px;
               ">
              Drop
            </a>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <html>
      <body style="
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        background: #f7f7f7;
        padding: 16px;
      ">
        <h2>📥 Inbox (${inboxItems.length} 件)</h2>

        <p style="color:#555;">
          本日時点で残っている Inbox 項目です。  
          各項目について、直感的に判断してください。
        </p>

        ${itemsHtml}

        <hr style="margin-top:24px;" />

        <p style="font-size:12px; color:#888;">
          このメールは自動生成されています。
        </p>
      </body>
    </html>
  `;
}