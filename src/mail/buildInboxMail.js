export function buildInboxMail(inboxItems, origin) {
  if (inboxItems.length === 0) {
    return "本日の Inbox は空です 🎉";
  }

  let body = `本日時点で残っているInbox 項目は ${inboxItems.length} 件です。\n\n`;

  inboxItems.forEach((item, index) => {
    body += `${index + 1}. ${item.title}\n`;
    body += `   作成日: ${item.created}\n`;
    body += `   ▶ Do: ${origin}/action/move?id=${item.id}&status=Do\n`;
    body += `   ▶ Someday: ${origin}/action/move?id=${item.id}&status=Someday\n`;
    body += `   ▶ Drop: ${origin}/action/move?id=${item.id}&status=Drop\n\n`;
  });

  return body;
}
