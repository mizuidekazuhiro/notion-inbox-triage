# notion-inbox-triage

Notion Inbox を取得し、HTML/JSONとして出力したり、Inbox から Tasks への移動を行う Cloudflare Workers 向けの API です。既存のエンドポイント・レスポンス形式・ルーティングを維持しつつ、最小限の挙動変更で整理しています。

## できること
- Notion Inbox の一覧取得（JSON）
- iOSショートカット用の choices 取得（Inbox / Projects）
- iOSショートカット高速化用の Projects choices 取得（/api/projects/choices）
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
- `/api/projects/choices`：iOSショートカット高速化用の Projects choices 取得
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

## iOSショートカット高速化（Projects choices）
Projects の選択肢は、辞書参照を避けるため `/api/projects/choices` を使うのが推奨です。
従来の `/api/projects/shortcut` は互換性維持のため残してあり、既存ショートカットはそのまま動きます。

### 最小手順（例）
1. **URL の内容を取得**: `GET /api/projects/choices`
2. **辞書から値を取得**: レスポンスの `choices` 配列を取り出す
3. **リストから選択**: `choices` をリストとして表示（表示名は `label`）
4. **値の取得**: 選択された項目の `value` を `project_id` として後続の `/action/move` に渡す

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

### ステータス選択画面（`/move/choose`）
- `/move/choose` は Inbox page を Tasks DB に移すためのステータス選択画面です。
- 選択肢は `Do` / `Waiting` / `Someday` / `Thinking` / `Done` / `Drop` です。
- URL には `inbox_page_id` と `sig` が必要です。
- `sig` は `ACTION_SECRET` による HMAC-SHA256 署名です。

### Inbox → Tasks のプロパティ転記ルール
- Inbox ページ取得後、Inbox DB / Tasks DB のスキーマを参照し、**Tasks DB 側に同名かつ型互換のあるプロパティ**だけを自動転記します。
- title は Inbox 側の title プロパティ（通常は `Name`）から、Tasks DB 側の title プロパティ（通常は `名前`）へ、**固定名に依存せず title type を検出して**コピーします。
- `Raw` のような本文相当の `rich_text` プロパティは、Inbox / Tasks の両方に同名プロパティが存在すればそのまま転記されます。
- `select` / `multi_select` / `rich_text` / `date` / `checkbox` / `url` / `email` / `phone_number` / `number` / `relation` / `people` は可能な範囲でコピーします。
- `Processed` / `Processed At` / `Undo URL` / `Inbox Page ID` / `Triage Source` / `Triage At` / `Status` は Inbox 由来をコピーせず、システム側で設定します。
- `formula` / `rollup` / `created_time` / `created_by` / `last_edited_time` / `last_edited_by` / `unique_id` / `verification` / `button` などの read-only 系プロパティはコピーしません。
- Tasks DB に存在しない追加プロパティは無視されます。
- Tasks 作成後の Undo URL 更新処理は従来通り維持されます。

### Inbox → Tasks の本文（ページ body / block children）転記
- `/action/move` ではプロパティだけでなく、Inbox ページの本文 block children も Tasks ページ本文へ複製します。
- 本文転記は既存 block の「移動」ではなく、source block を読み取って append 可能な payload に変換し、Tasks 側へ新規 block として append します。
- Notion API の制約に合わせ、append は 100 block ごとのバッチで実行します。
- `child_page` / `child_database` / `link_preview` / `unsupported` など再生成が難しい block はスキップする場合があります（スキップ件数・種別はログに出力）。
- 本文転記に失敗した場合は Inbox を成功扱いにせず、`Processed` / `Processed At` は更新しません。作成済み Task は best-effort でアーカイブ cleanup を試行します。

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

### 本文コピーの手動テスト手順
1. 本文あり Inbox ページを作成する
2. 本文に 箇条書き / `to_do` / `toggle` / `code` block を入れる
3. `/action/move` を実行する
4. Tasks 側ページ本文に block が複製されていることを確認する
5. Undo URL が維持されていることを確認する

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

## iPhone ScriptableウィジェットでInboxを見る

### 1) Workers 側の設定
- Cloudflare Workers の環境変数に `SHORTCUT_TOKEN` を設定します。
- `/api/widget/inbox` は `X-Shortcut-Token` ヘッダーで認証します。

### 2) iPhone 側の準備
1. iPhone に Scriptable アプリをインストールする
2. Scriptable で新規 Script を作成する
3. 下記コードを貼り付ける
4. `API_URL` を自分の Workers URL に変更する
5. `TOKEN` に Workers の `SHORTCUT_TOKEN` と同じ値を設定する
6. ホーム画面に Scriptable ウィジェットを追加する

- Widget Parameter は不要です。
- 更新間隔は Scriptable / iOS 側の制約を受けるため、厳密に 10 分ごとではありません。

### 完成版 Scriptable コード
```javascript
const API_URL = "https://notion-inbox-triage.kazuhiro-mizuide.workers.dev/api/widget/inbox?limit=5";
const TOKEN = "ここにSHORTCUT_TOKENを入れる";

const widget = new ListWidget();
widget.setPadding(12, 12, 12, 12);
widget.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);

const title = widget.addText("Inbox");
title.font = Font.boldSystemFont(16);

widget.addSpacer(6);

try {
  const req = new Request(API_URL);
  req.headers = {
    "X-Shortcut-Token": TOKEN
  };

  const data = await req.loadJSON();

  if (data.ok === false) {
    throw new Error(data.error || "api_error");
  }

  const count = data.count ?? 0;
  const items = data.items ?? [];

  const countText = widget.addText(`${count}件`);
  countText.font = Font.systemFont(12);

  widget.addSpacer(6);

  if (items.length === 0) {
    const empty = widget.addText("未処理タスクはありません");
    empty.font = Font.systemFont(13);
  } else {
    for (let i = 0; i < Math.min(items.length, 5); i++) {
      const line = widget.addText(`${i + 1}. ${items[i].title || "無題"}`);
      line.font = Font.systemFont(12);
      line.lineLimit = 1;
    }
  }

  widget.addSpacer(6);

  const updated = widget.addText(
    `更新 ${new Date().toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit"
    })}`
  );
  updated.font = Font.systemFont(10);

} catch (e) {
  const error = widget.addText("Inbox取得エラー");
  error.font = Font.systemFont(13);

  widget.addSpacer(4);

  const detail = widget.addText(String(e.message || e));
  detail.font = Font.systemFont(9);
  detail.lineLimit = 2;
}

Script.setWidget(widget);
Script.complete();
```
