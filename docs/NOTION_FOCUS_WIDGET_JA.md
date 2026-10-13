# Notion Focus — iPhone 大サイズウィジェット

## 概要

既存の Scriptable「Notion Week」とデザイン・接続方式を統一した **大サイズ専用** のToDoウィジェットです。

- ソース: `scripts/NotionFocusLarge.js`
- データ: 既存 `GET /api/mobile/tasks`（Notion Flowと同じ認証付きAPI）
- **新しいCloudflare API、Notion DBの変更、APIトークンの追加、外部課金はいずれも不要**
- コードをGitHubでマージしてもiPhone内のScriptableに自動配信されません。

## デザイン

- Midnight navy → dark teal のグラデーション背景
- 薄い枠線と半透明カード（ネイティブScriptableのWidgetStack）
- オレンジ: Do、シアン: Waiting、淡い赤: 期限超過
- 大きめの「DO / WAITING」件数カウンター
- **Action Now 最大3件 + Awaiting 最大2件**
- 各項目にはタスク名、親タスク名（子タスクの場合）、期日・再確認情報を表示
- フッターに親タスク件数、期限超過件数、Notion Flowへのリンク

## タスク表示方針

- `Status = Do / Waiting` だけを取得。Done、Someday、Dropは表示しません。
- 親タスク（`Task Level = 親タスク` または `is_parent=true`）は**作業一覧から除外**し、「案件管理 N件」カウンターに集計します。
- 子タスクでParent Taskがある場合は、親タスク名を補足表示します。
- 親に紐づかない子タスクは独立した実行タスクとして表示します。
- Task Levelが未設定でも、Do/Waitingなら除外せず「未分類」と表示します。
- Doは直近期日を優先。長期期限超過も非表示にはせず、他の対応がなければ表示します。期限超過件数は別途表示します。
- WaitingはReminder Dateが今日以前のものから優先。未設定時はWaiting Sinceの経過日数を補助的に利用します。
- 全体件数はヘッダー、実際の表示件数はSection見出しの`表示/全件`で確認します。
- 画面上でステータスの直接更新は行いません。**ウィジェットの背景、個別タスク、フッターのどこをタップしても** `https://notion-inbox-triage.kazuhiro-mizuide.workers.dev/mobile?tab=tasks` へ移動し、Notion Flowの **Tasksタブ** からステータスを変更できます。
- 取得結果はiOSのウィジェットメモリ上で表示し、ローカルファイルへのToDoデータ保存はしていません。

## iPhoneでの設定

1. `https://github.com/mizuidekazuhiro/notion-inbox-triage/blob/main/scripts/NotionFocusLarge.js` を開いて全文をコピー。
2. Scriptableで `+` → スクリプトを新規作成し、名前を `Notion Focus` として貼り付け。
3. Scriptableで `▶` 実行。Notion Weekと同じ `X-Shortcut-Token` をKeychainの `NOTION_WEEK_WIDGET_SHORTCUT_TOKEN` から読みます。**すでにNotion Weekを設定済みなら通常は再入力不要です。**
4. ホーム画面でScriptableウィジェットを**大**サイズで追加する。
5. ウィジェットを長押し → ウィジェットを編集 → **Script = Notion Focus**、When Interacting = Run Script、Parameter = 空欄。`widget.url` と `WidgetStack.url` を設定しているため、公式Scriptable仕様ではURL遷移がRun Script設定より優先されます。
6. ウィジェット内の数字、親子関係、タスク名を確認して完了。配置場所は利用者自身で決めます。

## トラブル対応

- 「認証キーをご確認ください」: iPhoneのScriptableアプリ内からNotion Focusを実行し、正しいX-Shortcut-Tokenを設定してください。認証キーをチャットへ送る必要はありません。
- 「通信エラー」: モバイル回線・Wi-Fi、Notion Flowが動いているかを確認してください。
- 予定が未反映: Notion Weekとは別のスクリプトであり、タスクにDate/Statusの反映が必要です。
- 正常時でもiOSがバックグラウンド更新タイミングを決めます。 `refreshAfterDate` の25分は**最短希望時刻**であって25分更新保証ではありません。
- widgetFamily=largeを前提にレイアウト設計・テストしています。他のサイズでは意図した余白になる保証はありません。

## 本番反映範囲

変更対象は**Notion FocusのScriptableスクリプト**と、**Notion FlowのTasksタブへのディープリンク対応（フロントエンドJS）**およびテストです。API、Notion DB、既存のNotion Weekのコードは変更しません。Scriptableの新しいコードはiPhoneのNotion Focusに全文貼り直してください。管理画面がSafari等で開くか、ホーム画面の独立したPWAとして開くかはiOSのリンク処理によります。認証セッションが異なる場合はNotion Flowへの再ログインが必要です。
