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
- **「＋ タスク」から直接登録**：Notion Flowの上部に常時表示されるボタンから、Inboxを経由せずTasks DBへ登録。
  - 必須：タスク名。初期値は `Do`・`子タスク`（独立した作業としても登録可）。
  - 任意：`Status`（Do / Waiting / Someday / Thinking）、`Task Level`（子タスク / 親タスク）、Priority、Due Date、Waiting時のReminder Date、メモ（Context）、Project、Parent Task。
  - 親タスクを選択するとProjectを自動継承。親子関係に矛盾するProject指定はエラーにして安全停止。
  - 登録後はDo/Waitingだけが現行のTasks一覧に表示。Someday/ThinkingもNotionに保存されますが、現行一覧の対象外です。
  - ステータスに合わせて `Since Do` / `Waiting Since` / `Since Someday` / `Since Thinking` を設定。`Triage Source = Manual (URL click)`、`Triage At`も記録。
  - 通信失敗等で登録結果が不明な場合は、**同じタスクを繰り返し登録せずNotionで存在を確認**。
- 両操作とも実行前に確認し、サーバーの結果を受けて一覧を再取得します。
- プロジェクト・期限・親子Relationを勝手に変更しません。
- Done/Waiting/Do/Somedayへ切り替えた際、既存のStage用日付（Done date / Waiting Since / Since Do / Since Someday）の**該当するものだけ**を更新します。既存の Reminder Date や Due Date は変更しません。

## セキュリティ
- `GET /mobile` 等は公開の静的UI。データは含みません。
- `/api/mobile/*` は、既存ショートカットの `X-Shortcut-Token` または認証済みWebアプリの署名Cookieで認証します。Tokenを使用する従来のiPhoneショートカットには影響しません。
- Notion API secret は Worker の中だけ。ブラウザに配布しません。
- 認証キーはログイン時にのみ使用し、ブラウザ保存領域（`sessionStorage` / `localStorage`）には**保存しません**。代わりにサーバー署名済み `__Host-` Cookieを `HttpOnly; Secure; SameSite=Strict` で発行します。Cookieに元の認証キーは含めません。30日有効、残り7日を切ってアクセスすると延長します。端末の「解除」でCookieを削除します。
- 変更は POST JSONのみ。同一Origin要求・JSON Content-Type・サイズ制限・UUID/ステータス検証・所属DBチェックを行います。Cookie認証での書き込みは、追加で `Origin` および `X-Notion-Flow: 1` ヘッダーを検証してCSRFを防ぎます。
- 新規登録は認証付き `POST /api/mobile/task/create` のみ。親タスク候補は認証付き `GET /api/mobile/task/parents` から取得します。タスク名・日付・Status・Priority・親子ID・Project IDはサーバー側で検証します。
- 他端末でステータスが変わっていた場合は409 Conflictで書き込みを拒否します。
- CSP / no-store を設定。ユーザー提供タイトルは `textContent` で表示。
- Service Workerは静的UIのシェルのみキャッシュし、NotionやAPIの情報はキャッシュしません。
- **注意**：旧エンドポイント（`/api/inbox`、`/action/move` のGET等）は互換性維持のため今回は変更していません。別途アクセス制御の監査を推奨します。

## デプロイ
1. [GitHub PR](../pulls)をレビューし、`npm test` / GitHub Actions の結果が正常であることを確認。
2. PRを `main` にマージ。Cloudflare Workers のプロジェクト `notion-inbox-triage` で **明示的にデプロイ**する。既存デプロイ手順に従うか、適切な権限を持つPC上で `npx wrangler deploy`。現在GitHubにCloudflareデプロイ用のWorkflowは存在しません。
3. Workerの `SHORTCUT_TOKEN`, `NOTION_TOKEN`, `INBOX_DB_ID`, `TASKS_DB_ID`, `PROJECTS_DB_ID`, `ACTION_SECRET` が存在することを確認。**秘密鍵の値をチャット・Issue・PRに貼らないこと。**
4. iPhoneのSafariから `https://notion-inbox-triage.kazuhiro-mizuide.workers.dev/mobile` にアクセス。
5. 既存ショートカットが送っている `X-Shortcut-Token` を、アプリ内の認証画面に**一度だけ**入力して接続。次回からCookieで再ログインを省略します。Notion APIのintegration tokenではありません。
6. iPhone Safariの共有メニュー→「ホーム画面に追加」で「Notion Flow」を追加。iOSによって表示文言が異なる場合があります。

## 新規登録のiPhone操作
1. ホーム画面で既存の **Notion Flow** を起動する。Scriptableの貼り替えは不要。
2. 画面上部の **＋ タスク** をタップ。
3. タスク名を入力し、必要ならステータス・優先度・期限・親タスク・Project・メモを指定して「Notionにタスクを登録」をタップ。
4. 確認ダイアログでOKを選択。登録成功後はTasksへ自動で切り替え、Do/Waitingであれば一覧に反映される。
5. 画面に追加機能が出ない場合は、一度Notion Flowを閉じて開き直し、必要ならSafariで `/mobile` を再読み込みする（ブラウザのService Workerキャッシュが残っている場合がある）。

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
- iOSでScriptableから通常のHTTPSリンクをタップすると、標準ブラウザ（Chrome / Google / Safari）で開く場合があります。**インストール済みWebアプリへリンクから必ず切り替えることは保証できません**。Safari、Chrome、ホーム画面WebアプリではCookieの保存領域が分かれることがあり、最初に1回ずつログインが必要です。その後はCookieで一定期間保持できます。
- 署名Cookieはステートレス方式であり、通常の「解除」は利用中ブラウザのCookieを削除します。端末外に複製されたCookieを個別に失効させるサーバー側のセッション台帳はありません。既存の `ACTION_SECRET` または `SHORTCUT_TOKEN` のローテーションで全セッションを失効させられます。共有端末利用は推奨しません。
- 複数人認証・生体認証・監査ログ・レート制限が必要なら、Cloudflare Access / Passkeysなどの認証方式へ拡張してください。現状は個人利用を前提としています。
- APIの大規模ページングは各DB最大1000件まで。超過時は `truncated` を表示します。
- Notionの書き込みは既存の移動処理を再利用。移動後のProcessed At更新を読み直して検証します。もし検証に失敗した場合も、Taskが新規作成されている可能性があります。再実行せずNotion側を確認してください。
- 現在レビュー中の週間予定Scriptable PRとは別の変更です。後から併用できます。


## 開始予定日・期限と表示期間（2026-10-27）

- 「＋タスク」で「いつから（開始予定日）」「いつまで（期限）」を指定できます。両方任意で、開始日が自動で今日になることはありません。期限より後の開始日は登録できません。
- 開始日は「今日から／明日から／来週から／開始日なし」でも指定できます。来週からは翌週月曜日です。
- タスク一覧には期間、開始日のみ、期限のみ、日付未設定を表示します。タスクを開き「開始予定日・期限を編集」で更新・解除できます。
- 初期表示「今やる」は開始日を迎えた実行タスク、開始日がなく期限まで7日以内のタスク、期限超過、再確認日を迎えたWaiting（再確認日がない場合は待機3日以上）が対象です。
- 明示された開始日が未来の場合は、期限が近くても開始前として扱います。前工程が未完了または状態未確認の場合は前工程待ちです。前工程はNotionの「次のタスクにより保留中：」で確認し、Doneになって初めて解除します。タスクを自動でDoneにする処理はありません。
- 「今後7日」は現在の実行対象と7日先までに開始・期限・再確認日を迎えるもの、「すべて」はDo/Waiting全件です。日付未設定、先の予定、前工程待ちの件数も表示します。新規登録直後は「すべて」に切り替えて作成したタスクを確認できます。
- 日付未設定のタスクを今やる対象にするには開始予定日を今日に設定してください。

### 日付の保存と互換性

- 既存Notionの `Due Date` の日付範囲は「開始予定日〜期限」として読みます。単一日は従来どおり期限です。既存の期間データを一括で書き換える必要はありません。
- 新しい期間も `Due Date` の範囲に保存するため、Notionの既存ガントと連携できます。開始日のみのタスクは追加のdateプロパティ `Start Date` に保存します。期間を設定した際は `Start Date` を空にして二重管理を防ぎます。
- `Since Do`、`Done date`、`Event Date`、ステータス、親子・依存関係は期間の編集では変更しません。日付編集前に競合を確認し、保存後に再取得して両端の日付を確認します。未編集の時刻を持つ日付はその時刻を維持します。
- 共通のタスク取得で期間の終了側を期限とするため、既存の期限順ソート・メール集計でも開始日を期限と誤認しなくなります。

### Scriptable / API

- `/api/mobile/tasks` の既定は `scope=focus`（今やる対象＋案件集計用の親タスク）です。既存Notion Focusが同じURLを利用していれば、スクリプトを貼り直さずに先の予定の混入を止められます。
- 全Do/Waitingを必要とするアプリ・クライアントは `/api/mobile/tasks?scope=all` を使用してください。モバイル画面はこの指定で全件を取得して表示切替します。認証方法は変更していません。
- `scope=focus`、全件数、先の予定・日付未設定・前工程待ちの件数をレスポンスに追加しました。Scriptableは対象外のタスクで空き枠を埋めません。
- 新版 `scripts/NotionFocusLarge.js` は開始日も表示できます。開始日表示の追加をiPhoneに反映する場合はスクリプトの更新が必要です。従来の最大6行とデザインは維持します。
- 旧TodayウィジェットAPIも開始前・遠い期限・日付未設定を除外します。予定カレンダーの `Event Date` に関する動作は変更していません。

### 公開前の前提・検証

1. Tasks DBにdate型の `Start Date` が必要です。この変更で2026-10-27に追加・再取得確認済みです。既存行の値は変更していません。
2. ローカルの `npm test`、生成クライアントの構文確認、モックAPIによるDOM操作（登録・不正日付・編集・表示切替）を実施します。実Notionへのテストタスク作成は行っていません。
3. Cloudflareで `notion-inbox-triage` を明示的にデプロイしてください。GitHubへのマージだけでは公開完了になりません。既存の環境変数と秘密鍵は維持してください。
4. 公開後はPWAを再読み込みし、既存の期間が両端表示になること、登録・編集、Scriptableの将来タスク除外を実機で確認してください。
