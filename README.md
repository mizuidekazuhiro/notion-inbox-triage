# notion-inbox-triage

Notion Inbox を取得し、HTML/JSONとして出力したり、Inbox から Tasks への移動を行う Cloudflare Workers 向けの API です。

## できること
- Notion Inbox の一覧取得（JSON）
- iOSショートカット用の choices 取得
- Inbox を HTML で確認（ブラウザ用）
- Inbox → Tasks への移動（GET/POST）
- Undo（作成した Task をアーカイブし、Inbox 側を復旧）
- Tasks Digest の生成（Do / Someday）
- ステータス変更の確認画面 + 署名付き POST 更新
- Cron（scheduled）実行の入口

## 主要エントリ
### `src/index.js`
Workers の HTTP エンドポイントを提供し、以下の用途を担います。

- `/test/token`：環境変数のトークン確認
- `/api/inbox`：Inbox の JSON 取得
- `/api/inbox/shortcut`：ショートカット向けの choices 取得
- `/inbox`：Inbox HTML
- `/mail/content`：メール本文生成
- `/action/move`：Inbox → Tasks 移動（GET/POST）
- `/action/undo`：Undo
- `/api/tasks/do`：Tasks の Do 一覧
- `/api/tasks/someday`：Tasks の Someday 一覧
- `/mail/digest`：Tasks Digest のメール本文生成
- `/confirm`：ステータス変更の確認画面
- `/action/task/update`：確認後のステータス更新（POST）

### `src/index.ts`
Cron / scheduled 実行の入口です。`runDailyInboxMail` を呼び出します。

## ディレクトリ概要
- `src/notion/`：Notion API 呼び出し関連
- `src/routes/`：API ルート実装
- `src/mail/`：メール/HTML 生成
- `wrangler.toml`：Workers 設定

## 必要な環境変数（例）
- `NOTION_TOKEN`
- `TASKS_DB_ID`
- `BASE_URL`
- `ACTION_SECRET`（Confirm 署名用の秘密鍵）
- `MAIL_FROM`
- `MAIL_TO`
- `MAIL_FROM_NAME`（任意）
- `SHORTCUT_TOKEN`（任意、ショートカット API の認証）

## Tasks Digest の送信方法
### Workers 内で送信する場合
`MAIL_FROM` と `MAIL_TO` を設定し、`scheduled()` で `sendMail` を実行します。

### 外部から送信する場合（GitHub Actions / Python など）
`/mail/digest` の JSON を取得し、外部で送信します。本文生成と送信を分けることで、Workers 側に送信情報だけを置けます。

## メール設定（MailChannels）
このプロジェクトは MailChannels の HTTP API で送信します。Cloudflare Workers から送信できるようにするため、以下を設定してください。
MailChannels の Cloudflare 向け API は **Cloudflare Workers からの送信のみ許可**されているため、ローカルの Node 実行などで叩くと 401 が返ります。動作確認は `wrangler dev --remote` か本番 Workers で行ってください。

### 1. 送信元アドレスの準備
- `MAIL_FROM` に送信元アドレス（例: `notify@example.com`）を設定します。
- MailChannels のポリシーに合わせて、送信元ドメインが DNS で検証されていることを確認してください。
- 表示名を変えたい場合は `MAIL_FROM_NAME` を設定します。

### 2. 宛先アドレスの設定
- `MAIL_TO` に受信先アドレスを設定します。
- 複数宛先にしたい場合は、Workers 側の `sendMail` 呼び出し前に配列化するなどの拡張が必要です。

### 3. Workers の環境変数に追加
`wrangler.toml` または Cloudflare Dashboard の Variables に設定します。

```
MAIL_FROM="notify@example.com"
MAIL_TO="you@example.com"
MAIL_FROM_NAME="Notion Inbox Bot"
```

### 4. 動作確認
- `/mail/digest` をブラウザで開くと、件名・本文の JSON が取得できます。
- `scheduled()` の cron 実行、または後述の GitHub Actions から送信できます。

## GitHub Actions で「ボタンを押して送信」する
`.github/workflows/send-tasks-digest.yml` を用意しています。Actions の `Send Tasks Digest` を手動実行するとメールが送信されます。

### 事前に設定する GitHub Secrets
リポジトリの **Settings → Secrets and variables → Actions** に以下を追加します。

- `WORKER_URL`：Workers の URL（例: `https://notion-inbox-triage.example.workers.dev`）
- `MAIL_FROM`：送信元アドレス
- `MAIL_TO`：送信先アドレス
- `MAIL_FROM_NAME`：任意の表示名（未設定なら `Notion Inbox Bot`）

### 実行手順
1. GitHub の **Actions** タブを開く
2. **Send Tasks Digest** を選択
3. **Run workflow** を押して送信

## Cron 例（JST 7:00 相当）
Cloudflare Workers の cron は UTC です。JST 7:00 は以下の通りです。

```
0 22 * * *
```

## 使い方（概要）
1. Cloudflare Workers にデプロイ
2. Notion API トークンと DB ID を設定
3. 各エンドポイントを用途に応じて呼び出す
