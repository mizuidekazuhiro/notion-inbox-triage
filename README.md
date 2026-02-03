# notion-inbox-triage

Notion Inbox を取得し、HTML/JSONとして出力したり、Inbox から Tasks への移動を行う Cloudflare Workers 向けの API です。既存のエンドポイント・レスポンス形式・ルーティングを維持しつつ、最小限の挙動変更で整理しています。

## できること
- Notion Inbox の一覧取得（JSON）
- iOSショートカット用の choices 取得（Inbox / Projects）
- Inbox を HTML で確認（ブラウザ用）
- Inbox → Tasks への移動（GET/POST）
- Undo（作成した Task をアーカイブし、Inbox 側を復旧）
- Tasks Digest の生成（Do/Waiting / Someday）
- ステータス変更の確認画面 + 署名付き POST 更新
- Cron（scheduled）実行の入口
- Cloudflare Email Routing で受信したメールを Inbox DB へ自動登録

## 主要エントリ
### `src/index.js`
Workers の HTTP エンドポイントを提供し、以下の用途を担います。

- `/test/token`：環境変数のトークン確認
- `/api/inbox`：Inbox の JSON 取得
- `/api/inbox/shortcut`：ショートカット向けの choices 取得
- `/api/projects/shortcut`：Projects DB の choices 取得
- `/inbox`：Inbox HTML
- `/mail/content`：メール本文生成
- `/action/move`：Inbox → Tasks 移動（GET/POST）
- `/action/undo`：Undo
- `/undo`：Undo（署名付き URL 用のエイリアス）
- `/api/tasks/do`：Tasks の Do 一覧
- `/api/tasks/someday`：Tasks の Someday 一覧
- `/api/tasks/do-waiting`：Tasks の Do/Waiting 一覧
- `/mail/digest`：Tasks Digest のメール本文生成（Do/Waiting を含む）
- `/confirm`：ステータス変更の確認画面
- `/action/task/update`：確認後のステータス更新（POST）
- `/test/email-to-inbox`：Email Routing 非依存の Inbox 作成（subject/body クエリ）
- `/test/inbox/create`：テスト用 Inbox 作成（subject/body クエリ）

加えて、Email Routing からの受信イベント（`email` ハンドラ）を実装しています。

### `src/index.ts`
Cron / scheduled 実行の入口です。`runDailyInboxMail` を呼び出します。

## ディレクトリ概要
- `src/notion/`：Notion API 呼び出し関連
- `src/email/`：メール本文の抽出・整形
- `src/routes/`：API ルート実装
- `src/mail/`：メール/HTML 生成
- `scripts/`：外部送信スクリプト
- `wrangler.toml`：Workers 設定

## 必要な環境変数（Workers）
### 必須
- `NOTION_TOKEN`
- `INBOX_DB_ID`
- `TASKS_DB_ID`
- `PROJECTS_DB_ID`（/api/projects/shortcut 用）
- `ACTION_SECRET`（Confirm/Undo 署名用の秘密鍵）

### 任意
- `SHORTCUT_TOKEN`（ショートカット API の認証）
- `BASE_URL`（未設定の場合はリクエスト URL を使用）
- `INBOX_SOURCE_VALUE`（未設定なら "Email"）

## Tasks Digest の送信方法
Workers は「本文生成」のみを担当し、送信は GitHub Actions から Gmail SMTP で行います。

### 📨 Tasks Digest（Do / Waiting）の仕組み

- 毎朝の Tasks Digest では、単純な「Do」だけでなく、
  「対応すべき Waiting タスク」も Do/Waiting として表示します。
- 対象条件は以下です。
  - Status = Do
  - Status = Waiting かつ
    - Reminder Date が今日以前
    - または Reminder Date 未設定で Waiting since から 3 日以上経過

### なぜ Notion filter で判定しないのか
- Notion Database Query は and/or の配列に undefined を含むと 400 validation_error になります。
- Reminder Date 未設定・Waiting since 未設定のタスクが混在するため、
  複雑な条件を filter 側で組み立てると壊れやすいです。
- そのため、本システムでは以下の責務分離を採用しています。
  - Notion API：Status = Do / Waiting までの粗い抽出
  - Cloudflare Workers：Reminder Date / Waiting since / 日数計算などの業務ロジック

### 安定性のための設計ルール
- Notion filter の and/or 配列には undefined を絶対に入れない
- date プロパティは常に null の可能性を考慮する
- Digest 生成処理は失敗しても Worker 全体を落とさない（return [] で継続）

## Gmail SMTP（App Password）で送信する
`scripts/send_digest_smtp.mjs` が `/mail/digest` の JSON を取得し、Gmail SMTP で送信します。

### 1. Gmail のアプリパスワードを作成
1. Google アカウントで 2 段階認証を有効化する
2. Google アカウントの「アプリ パスワード」から新規作成
3. 16 桁のアプリパスワードを控える

### 2. GitHub Actions Secrets
リポジトリの **Settings → Secrets and variables → Actions** に以下を追加します。

- `GMAIL_USER`：送信元 Gmail アドレス（例: `xxx@gmail.com`）
- `GMAIL_APP_PASSWORD`：Google のアプリパスワード（16 桁）
- `MAIL_TO`：送信先アドレス
- `DIGEST_URL`：Workers の `/mail/digest` URL（例: `https://<worker-domain>/mail/digest`）

### 3. Actions で送信
`.github/workflows/send_tasks_digest.yml` が毎朝 07:00 JST（22:00 UTC）に実行されます。手動送信する場合は `workflow_dispatch` で実行できます。
GitHub Actions のスケジュールは UTC 基準なので、07:00 JST に合わせるには `0 22 * * *` を設定します。

### 4. ローカルで実行（任意）

```bash
npm install
npm run send:digest
```

## Cron 例（JST 07:00 相当）
Cloudflare Workers の cron は UTC です。JST 07:00 は以下の通りです。

```
0 22 * * *
```

## Cron スケジュール一覧（JST/UTC）
Workers と GitHub Actions は **同じ UTC cron** に統一しています（JST 07:00）。役割は「Workers = digest 生成」「Actions = 送信」です。

| Trigger | JST | UTC | Cron |
| --- | --- | --- | --- |
| Cloudflare Workers scheduled | 07:00 JST | 22:00 UTC (previous day) | `0 22 * * *` |
| GitHub Actions schedule | 07:00 JST | 22:00 UTC (previous day) | `0 22 * * *` |

## 使い方（概要）
1. Cloudflare Workers にデプロイ
2. Notion API トークンと DB ID を設定
3. 各エンドポイントを用途に応じて呼び出す

## Inbox → Tasks 移動（/action/move）
### GET（従来互換）
```
GET /action/move?id=<inbox_page_id>&status=Do
```

### POST（ショートカット向け JSON）
以下の JSON を受け付けます。`status` のみでも従来通り動作します。

```json
{
  "inbox_page_id": "<page_id>",
  "status": "Do",
  "priority": "High",
  "due_date": "2024-01-12",
  "project_id": "<PROJECT_PAGE_ID>",
  "reminder_date": "2024-01-15"
}
```

- `inbox_page_id`（必須）: Inbox のページ ID（従来の `id` も可）
- `status`（必須）: `Do` / `Waiting` / `Someday` など
- `priority`（任意）: Status=Do の場合のみ反映（未指定なら何もしない）
- `due_date`（任意）: Status=Do の場合のみ反映（YYYY-MM-DD など）
- `project_id`（任意）: Status=Do の場合のみ反映（Project relation の page.id）
- `reminder_date`（任意）: Status=Waiting の場合のみ反映（YYYY-MM-DD など）

日付は ISO 文字列や Date 文字列でも受け付け、JST 基準で `YYYY-MM-DD` に正規化して Notion に渡します。正規化できない場合は該当プロパティ更新をスキップします。

### デバッグモード（X-Debug）
`X-Debug: 1` を付けると、受信 body と allowlist した headers を含む JSON を返します。

```bash
curl -X POST "$WORKERS_ENDPOINT/action/move" \
  -H "X-Shortcut-Token: <SHORTCUT_TOKEN>" \
  -H "X-Debug: 1" \
  -H "Content-Type: application/json" \
  -d '{"id":"...","status":"Do"}'
```

### 手動確認（Undo URL）
1) Inbox のアイテムを `/action/move` で Tasks に移動する
2) Tasks DB の "Undo URL" プロパティに URL が入っていることを確認する
3) その URL にアクセスし、Undo 画面/Undo 実行に到達できることを確認する

### 動作確認例（/test/inbox/create を使用）
1) Inbox を作成
```bash
curl -sS "<BASE_URL>/test/inbox/create?subject=ShortcutTest&body=Hello"
```

2) Status=Do + Priority + Due Date
```bash
curl -sS -X POST "<BASE_URL>/action/move" \
  -H "Content-Type: application/json" \
  -H "X-Shortcut-Token: <SHORTCUT_TOKEN>" \
  -d '{
    "inbox_page_id": "<INBOX_PAGE_ID>",
    "status": "Do",
    "priority": "High",
    "due_date": "2024-01-12",
    "project_id": "<PROJECT_PAGE_ID>"
  }'
```

3) Status=Waiting + Reminder date
```bash
curl -sS -X POST "<BASE_URL>/action/move" \
  -H "Content-Type: application/json" \
  -H "X-Shortcut-Token: <SHORTCUT_TOKEN>" \
  -d '{
    "inbox_page_id": "<INBOX_PAGE_ID>",
    "status": "Waiting",
    "reminder_date": "2024-01-15"
  }'
```

## Notion 側の前提プロパティ名
### Tasks DB
- Status
- Priority
- Project（relation）
- Due Date（date）
- Processed
- Processed At
- Triage At
- Triage Source
- Inbox Page ID
- Undo URL
- Reminder Date
- Waiting since
- Since Do
- Since Someday

### Projects DB
- 名前（title）

## iOSショートカットから叩く POST 例
### Do（Priority + Due Date + Project）
```bash
curl -sS -X POST "<BASE_URL>/action/move" \
  -H "Content-Type: application/json" \
  -H "X-Shortcut-Token: <SHORTCUT_TOKEN>" \
  -d '{
    "inbox_page_id": "<INBOX_PAGE_ID>",
    "status": "Do",
    "priority": "High",
    "due_date": "2024-01-12",
    "project_id": "<PROJECT_PAGE_ID>"
  }'
```

### Waiting（Reminder Date）
```bash
curl -sS -X POST "<BASE_URL>/action/move" \
  -H "Content-Type: application/json" \
  -H "X-Shortcut-Token: <SHORTCUT_TOKEN>" \
  -d '{
    "inbox_page_id": "<INBOX_PAGE_ID>",
    "status": "Waiting",
    "reminder_date": "2024-01-15"
  }'
```

## 手動テスト手順（簡易）
```bash
# Inbox choices（既存互換）
curl -sS "<BASE_URL>/api/inbox/shortcut"

# Projects choices（新規）
curl -sS "<BASE_URL>/api/projects/shortcut"

# Inbox -> Tasks（Do + Project）
curl -sS -X POST "<BASE_URL>/action/move" \
  -H "Content-Type: application/json" \
  -H "X-Shortcut-Token: <SHORTCUT_TOKEN>" \
  -d '{
    \"inbox_page_id\": \"<INBOX_PAGE_ID>\",
    \"status\": \"Do\",
    \"priority\": \"High\",
    \"due_date\": \"2024-01-12\",
    \"project_id\": \"<PROJECT_PAGE_ID>\"
  }'
```

## Email Routing → Notion Inbox 連携
Cloudflare Email Routing で受信したメールを Notion の Inbox DB に「メール1通=1インボックスタスク」として登録します。

### 追加・変更したファイル
- `src/email/parseEmail.js`：件名/本文抽出、HTML→テキスト化、Rich text chunk 分割
- `src/notion/notionHeaders.js`：Notion API 共通ヘッダー
- `src/notion/inboxCreate.js`：Inbox DB へのページ作成
- `src/index.js`：email ハンドラの waitUntil 化とテスト用エンドポイント

### 必要な環境変数
- `NOTION_TOKEN`：Notion API トークン
- `INBOX_DB_ID`：Inbox DB の ID

### Cloudflare Email Routing 設定
1. Cloudflare Dashboard で Email Routing を有効化
2. 対象アドレス（例: `Inbox@your-domain.com`）を作成
3. Destination を “Workers” に設定し、この Worker を指定
4. Dropped が出た場合は Worker Logs の `email handler scheduling failed` / `processInboundEmail failed` / `Notion create failed` を確認

### 動作確認手順（Email Routing + Worker）
1. Cloudflare Email Routing を Worker に接続
2. 任意のメールを送信
3. Worker Logs で受信ログと Notion 作成ログを確認
4. Notion Inbox DB に「メール1通=1件」で登録されることを確認

### テスト用エンドポイント（任意）
Email Routing の挙動が不安定な場合は以下で Inbox 作成の動作確認ができます。

```
GET /test/email-to-inbox?subject=Hello&body=Test
```

```
GET /test/inbox/create?subject=Hello&body=Test
```
