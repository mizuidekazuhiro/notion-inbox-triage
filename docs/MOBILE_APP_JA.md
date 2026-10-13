# Notion Flow — iPhone用 Inbox / Tasks アプリ

## 結論
既存の Cloudflare Worker に `/mobile` を追加し、Safariの「ホーム画面に追加」で使用する **PWA** です。App Store登録やApple Developer契約は不要です。Notionは既存の Inbox DB / Tasks DB / Project DB を使います。既存のiOSショートカットの処理・URLは変更しません。

本機能のリリースは **GitHubのPRマージだけでは完了しません**。Cloudflare WorkerへのデプロイとiPhoneでの実機確認が必要です。

## 画面仕様
- **Inbox**：未処理アイテムの一覧。各行をタップ→移動先を Do / Waiting / Someday / Thinking / Done / Drop から選択。
  - Do：優先度・期限・Project を設定可能。
  - Waiting：再確認日（Reminder Date）を設定可能。
  - 旧 `/action/move` のプロパティ転記・原文複製・Undo登録を再利用。
- **Tasks**：Status=Do / Waiting の両方を **全件対象**として一覧表示（期限やリマインダーで絞らない）。サブフィルターあり。
  - 独立した実行タスク
  - Task Level未分類（見落とさないように別掲）
  - 親に紐づく子タスク（親タスク名ごとにグループ）
  - 親タスク（案件管理用、折りたたみ）
  - 各タスク→ Done / Waiting / Do / Someday のいずれかに更新。
- 両操作とも実行前に確認し、サーバーの結果を受けて一覧を再取得します。
- プロジェクト・期限・親子Relationを勝手に変更しません。
- Done/Waiting/Do/Somedayへ切り替えた際、既存のStage用日付（Done date / Waiting Since / Since Do / Since Someday）の**該当するものだけ**を更新します。既存の Reminder Date や Due Date は変更しません。

## セキュリティ
- `GET /mobile` 等は公開の静的UI。データは含みません。
- `/api/mobile/*` はすべて `X-Shortcut-Token` が必須。Workerの `SHORTCUT_TOKEN` と比較。
- Notion API secret は Worker の中だけ。ブラウザに配布しません。
- キーはURL、Cookie、長期 `localStorage` に置かず、iPhoneの **sessionStorage** のみに保持します。「解除」で消去できます。
- 変更は POST JSONのみ。同一Origin要求・JSON Content-Type・サイズ制限・UUID/ステータス検証・所属DBチェックを行います。
- 他端末でステータスが変わっていた場合は409 Conflictで書き込みを拒否します。
- CSP / no-store を設定。ユーザー提供タイトルは `textContent` で表示。
- Service Workerは静的UIのシェルのみキャッシュし、NotionやAPIの情報はキャッシュしません。
- **注意**：旧エンドポイント（`/api/inbox`、`/action/move` のGET等）は互換性維持のため今回は変更していません。別途アクセス制御の監査を推奨します。

## デプロイ
1. [GitHub PR](../pulls)をレビューし、`npm test` / GitHub Actions の結果が正常であることを確認。
2. PRを `main` にマージ。Cloudflare Workers のプロジェクト `notion-inbox-triage` で **明示的にデプロイ**する。既存デプロイ手順に従うか、適切な権限を持つPC上で `npx wrangler deploy`。現在GitHubにCloudflareデプロイ用のWorkflowは存在しません。
3. Workerの `SHORTCUT_TOKEN`, `NOTION_TOKEN`, `INBOX_DB_ID`, `TASKS_DB_ID`, `PROJECTS_DB_ID`, `ACTION_SECRET` が存在することを確認。**秘密鍵の値をチャット・Issue・PRに貼らないこと。**
4. iPhoneのSafariから `https://notion-inbox-triage.kazuhiro-mizuide.workers.dev/mobile` にアクセス。
5. 既存ショートカットが送っている `X-Shortcut-Token` を、アプリ内の認証画面に入力して接続。Notion APIのintegration tokenではありません。
6. iPhone Safariの共有メニュー→「ホーム画面に追加」で「Notion Flow」を追加。iOSによって表示文言が異なる場合があります。

## 受入試験（Notion実データの変更は明示的なテスト操作時のみ）
- 既存のiOSショートカットが移動可能なままか。
- Inbox件数がNotionの未処理アイテムと整合するか。
- Inbox → Do を1件移動し、Tasks側に原文・プロパティ・Undo URLが残るか（失敗時には無理に再実行しない）。
- Do → Waiting → Do → Done/Someday のうちテスト可能なケースを1件ずつ実行し、Notion側のStatusと日時を確認。
- 親タスクと親に紐づく子タスクが混在せず、グループ表示されるか。
- トークンなし／誤トークンでデータ取得・変更が拒否されるか。
- iPhoneの「ホーム画面に追加」後の表示と再起動を確認。

## 限界・今後の拡張
- PWAはネイティブiOSアプリではなく、オフラインでNotionの変更はできません。
- 複数人認証・生体認証・監査ログ・レート制限が必要なら、Cloudflare Access / Passkeysなどの認証方式へ拡張してください。現状は個人利用を前提としています。
- APIの大規模ページングは各DB最大1000件まで。超過時は `truncated` を表示します。
- Notionの書き込みは既存の移動処理を再利用。移動後のProcessed At更新を読み直して検証します。もし検証に失敗した場合も、Taskが新規作成されている可能性があります。再実行せずNotion側を確認してください。
- 現在レビュー中の週間予定Scriptable PRとは別の変更です。後から併用できます。
