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
- `MAIL_PROVIDER`（`mailchannels` or `gmail`）
- `GMAIL_CLIENT_ID`（Gmail OAuth）
- `GMAIL_CLIENT_SECRET`（Gmail OAuth）
- `GMAIL_REFRESH_TOKEN`（Gmail OAuth）
- `GMAIL_SENDER`（任意、Gmailの送信元アドレス）
- `SHORTCUT_TOKEN`（任意、ショートカット API の認証）

## Tasks Digest の送信方法
- Workers 内で送信する場合：`MAIL_FROM` と `MAIL_TO` を設定し、`scheduled()` で `sendMail` を実行します。
- 外部から送信する場合：`/mail/digest` の JSON を取得し、GitHub Actions / Python などで送信します。

### Gmail 送信（OAuth/Refresh Token）
Workers から Gmail API 経由で送信する場合は、以下を設定します。

- `MAIL_PROVIDER=gmail`
- `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN`
- `MAIL_FROM`（または `GMAIL_SENDER`）

`MAIL_FROM` は `From:` ヘッダとして利用されます。Gmail 側の送信元設定と一致させてください。

### 外部送信ワーカー化の具体案
`/mail/digest` で HTML を生成し、外部（GitHub Actions / Cloud Run など）から Gmail API で送信します。
これにより Workers 側に Gmail 認証情報を置かずに運用できます。

## Cron 例（JST 7:00 相当）
Cloudflare Workers の cron は UTC です。JST 7:00 は以下の通りです。

```
0 22 * * *
```

## 使い方（概要）
1. Cloudflare Workers にデプロイ
2. Notion API トークンと DB ID を設定
3. 各エンドポイントを用途に応じて呼び出す
