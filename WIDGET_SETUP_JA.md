# Notion 予定ウィジェット (iOS / Scriptable)

## 方針
既存の Notion Tasks DB に記録されている **Event Date** を予定として表示します。通常タスクの Due Date / Status=Do・Waiting の一覧は表示しません。予定は Status=Done のままでも対象です。取り消しを意味する Drop のみ除外します。

## 実装
- 認証済み GET `/api/widget/schedule/week?limit=20` が当日から7暦日分の未来・継続中の予定をJSTで返します。
- 認証ヘッダーは既存の `X-Shortcut-Token` を使用。Notion integration secret は Cloudflare Worker 内に留めます。
- Scriptable: `scripts/NotionWeekSchedule.js` を iPhone に貼り付け、一度アプリ内で実行すると Shortcut Token の安全な入力ダイアログが表示されます（Keychain保存）。
- 大ウィジェットで最大7件、中5件、小2件までを表示します。中サイズは「日付＋時刻｜予定名」の1行表示にして縦の余白を縮小します。中サイズで6件以上ある場合は右上に「5/6件」のように表示し、文字の切れを防ぎます。タップするとNotionで確認できます。
- Scriptableのコードを更新した場合は、**iPhoneのNotion Weekスクリプトを新しい内容で全文置換**してください。ホーム画面のウィジェット追加や認証キーの再登録は通常不要です（ScriptableのKeychainを維持する場合）。
- バックエンドは読み取り専用。既存の `/api/widget/tasks/today` 等の動作を変更しません。
- Scriptable の `refreshAfterDate` は5分後に更新をリクエストします。ただしiOSが実際の更新タイミングを決めるため、5分更新は保証されません。1分更新も保証できません。予定の正本をすぐ確認する場合はNotionを直接開いてください。

## 導入
1. PRをレビュー・マージし、既存Cloudflare Workerへデプロイする。PRをマージするだけではWorkerが更新されるとは限りません。
2. Worker側で `SHORTCUT_TOKEN`, `NOTION_TOKEN`, `TASKS_DB_ID` が設定済みであることを確認する。
3. iPhoneのScriptableを開き、`NotionWeekSchedule.js` 全文を新規スクリプトに貼り付けて `Notion Week` と命名する。
4. Scriptable内で直接実行して既存Worker用 `X-Shortcut-Token` を入力（このトークンはチャットに送らない）。
5. ホーム画面長押し → 編集 → ウィジェット追加 → Scriptable → 大 → 長押し「ウィジェットを編集」から Script=`Notion Week` を選ぶ。
6. プレビューで日付・時刻・予定名を確認する。

## 確認する点
- NotionにFuture Event Date を持つ Doneレコードが複数あることを確認済み。
- スクリプトからタスク締切（Due Date）は取得しない。
- Liquid Glassのアイコンとは色味を合わせていますが、iOS純正の背景ぼかしを完全再現するものではありません。
