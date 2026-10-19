# Notion予定連携：SMTP調査と復旧手順

確認日：2026年10月20日（日本時間）。調査したmain：`5594230663a01c92441cf245c94c754a6a373042`。

## 確認した事実

- 最新のScheduler実行は10月19日21:00 JST。573件取得、送信対象5件、送信成功0件、SMTP送信失敗5件。それでもGitHubの実行結果はsuccessになっていた。
  - [Scheduler実行ログ](https://github.com/mizuidekazuhiro/notion-inbox-triage/actions/runs/39248667994)
- 対象2件にはGmailの535認証エラーが残り、Send Schedulerはfalse、Scheduler Sent Atは空。両レコードの最終更新は上記実行中の21:00 JSTで、同じ失敗経路と整合する。
- 将来のDone予定を読み取り確認したところ、未送信・認証エラーは計5件。別の1件は送信済みフラグと送信日時がある。
- 10月19日08:56 JSTのTasks DigestもEAUTH / 535 / AUTH PLAINで失敗した。
  - [Digest実行ログ](https://github.com/mizuidekazuhiro/notion-inbox-triage/actions/runs/39178556678)
- 両workflowが同じSecrets `GMAIL_USER` / `GMAIL_APP_PASSWORD` を使う。Schedulerの最新ログは有効化変数true、認証Secretsが設定されていることを示す。値自体は取得・表示していない。
- Schedulerの宛先優先順位は `COMPANY_SCHEDULER_MAIL_TO` → `MAIL_TO`。最新ログでは前者は空、後者は設定済み。実際の宛先値は不明。

## プロパティと影響範囲

|項目|実装上の意味|
|---|---|
|Status=Done|予定登録完了。未来のEvent Dateと組み合わせてSchedulerの対象になる|
|Event Date|予定本体の日時。Notionと予定ウィジェットが読む|
|Send Scheduler|送信済み完了印。falseは未送信であり、送信を無効にする設定ではない|
|Scheduler Sent At|SMTP送信成功後に記録する日時。相手の受信・予定表登録を保証するものではない|
|Scheduler UID|招待の識別子。送信前に書くため、存在だけでは送信成功を意味しない|
|Scheduler Error|最後に書いた処理状態・エラー。元の設計に発生日時の専用欄はない|

1. **Notion予定登録**：保存済み。Schedulerは日時・Status・本文を変更しない。
2. **予定ウィジェット**：`/api/widget/schedule/week` がNotionのEvent Dateを直接読み、SMTPやScheduler欄を参照しない。Doneを含め、Dropだけを除外。当日を含むJSTの7暦日を表示する。10月20日の窓は10月20〜26日なので、10月22日は対象、10月27日開始の予定は10月21日から対象になる。
3. **Scheduler招待メール**：最新実行では5件失敗。会社メール側への招待送信と、その招待を取り込む予定表連携に影響する。
4. **朝のTasks Digest**：同じSMTP認証で失敗している。

ウィジェットのコードとNotionの値は確認したが、稼働Workerへの認証付き呼出し・iPhone実画面・受信側予定表は未確認。Notion固有のリマインダーや他経路の通知結果も、このSMTPログからは判定できない。

## 原因の切り分け

確定したのはGmailが提示された認証情報を拒否していること。パスワード失効・Googleアカウントの相違・コピー時の空白・アカウント制限のどれかは、Secrets内容やGoogle設定を読み取っていないため不明。Googleパスワード変更でアプリパスワードが失効することは公式仕様だが、今回その変更があったとは断定しない。

別に、Schedulerが送信失敗を集計するだけで非ゼロ終了しない実装上の問題があった。GitHubのsuccess表示はメール送信成功の証拠になっていなかった。

## この修正に含むもの

- 送信対象がある場合にSMTP認証を事前確認。失敗時はメール送信もNotion更新もしない。
- 実際の送信失敗や送信後のNotion更新失敗をGitHubの失敗として返す。実行途中の認証失敗では残りの送信を停止。
- 認証情報の前後・表示用空白を正規化。TLSを必須化し、SMTP応答原文を新規のエラー表示に含めない。
- 手動の `Verify Gmail SMTP (no email)` を追加。接続・TLS・AUTHだけを確認し、宛先もNotionトークンも読み込まない。
- Schedulerの同時実行を抑制。既存の送信済みチェック・送信日時・不確実送信の保護を維持。
- 日付範囲の招待が初日09:00〜12:00になる問題を修正。日付のみの範囲は終日予定にしてNotionの最終日を含める。時刻付き予定とendなし単日の既存動作は維持。

既存Notionレコードの変更、メール送信、Secrets変更、Workerデプロイは、この調査では行っていない。修正はPRのコードであり、mainへの反映前は稼働中の処理を変えない。

## 利用者が行う操作

1. [Actionsの変数設定](https://github.com/mizuidekazuhiro/notion-inbox-triage/settings/variables/actions) で、認証更新前に `TASK_SCHEDULER_ENABLED=false` を設定する。Digestの自動送信も止めて検証したい場合はActions → Send Tasks Digest → Disable workflowを一時的に選ぶ。認証更新だけで次の定期実行が5件の招待を送る可能性があるため、この順序にする。
2. 修正PRをmainに反映する。これで認証確認専用workflowをActionsから実行できる。
3. 送信に使うGoogleアカウントで[アプリパスワード設定](https://myaccount.google.com/apppasswords)を開く。2段階認証を有効にし、この連携用のアプリパスワードを新規発行する。通常のGoogleログインパスワードは使わない。アプリパスワードの項目がない場合はアカウント管理者・保護設定の確認が必要。
4. [ActionsのSecrets設定](https://github.com/mizuidekazuhiro/notion-inbox-triage/settings/secrets/actions)で、`GMAIL_USER` を発行元Googleアカウントの完全なメールアドレスに、`GMAIL_APP_PASSWORD` を新しいアプリパスワードに更新する。チャット、Issue、コード、ログには貼らない。`MAIL_TO`（必要なら `COMPANY_SCHEDULER_MAIL_TO`）の宛先も本人が設定画面で確認する。
5. Actions → **Verify Gmail SMTP (no email)** → Run workflow（main）を実行する。成功時に `smtp_verify_ok`、`emailSent:false`、`notionUpdated:false` が表示される。これは実際のメール配達・予定表取り込みまでは検証しない。
6. 招待送信を再開する場合だけ `TASK_SCHEDULER_ENABLED=true` に戻し、Send Task Event Schedulerを実行する。未送信の未来Done予定が対象になるため、対象5件を確認してから実行する。認証エラーの文字列やUIDを手で消す必要はなく、成功時にエラーがクリアされる。送信済みの正常な1件はそのまま除外される。
7. 成功後、対象のSend Scheduler=true、Scheduler Sent Atの記録、Scheduler Errorのクリア、実際の受信・予定表の日時を確認する。Digestも必要に応じて有効化する。`sending` / `email_sent_but_notion_update_failed` がある場合は、受信確認前にこれらを削除しない。

この調査では再設定後の認証、実メール配達、会社予定表への取込みは未実行。復旧完了の判定は手順5〜7の結果による。

公式資料：[Googleアプリパスワード](https://support.google.com/accounts/answer/185833)、[Nodemailer SMTP verify](https://nodemailer.com/smtp)。
