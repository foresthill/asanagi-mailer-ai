# 08 送信の信頼性と外部仕様メモ

送信（即時/予約）まわりの信頼性設計と、プロバイダ側の外部仕様変更の調査結果を
1か所にまとめる。実装は PR #320 / #321（2026-11）。

関連コード: `src/lib/email/imap.ts`（SMTP/IMAP）, `src/lib/email/gmail.ts`（Gmail API）,
`src/app/api/send/route.ts`, `src/app/api/schedule/route.ts`,
`src/components/mail/ReplyComposer.tsx`, `src/components/mail/Sidebar.tsx`。

## 1. 失敗を2層に分ける（事故防止の肝）

「送れていない＝相手に届いていない」を絶対に取りこぼさないため、失敗を重大度で
分ける。混同すると大事故になる。

- **第1層（重大＝未送信）**: 即時/予約送信が受理されなかった。相手に届いていない。
  - 送信・予約に失敗したら本文を失わないよう **「未送信」下書きへ自動退避**
    （`SavedDraft.failedSend = { error, at }`）。コンポーザは閉じず赤バナー＋退避した旨。
    同一下書きを更新して重複を防ぐ（`retainedIdRef`）。
  - **サイドバー「作成」直下に ⚠未送信 N件 の永続警告**を常時表示。どのフォルダ
    （受信トレイ含む）でも目に入る。**ログには見に行かせない**（一般ユーザーは気づかない）。
  - 予約送信の失敗は「見ていない間」に起きる＝最も事故りやすいので件数に合算。
    失敗した予約は `ScheduledPanel` の「消す」でアラートを解消できる（放置で残らない）。
- **第2層（軽微＝控え保存の失敗）**: 送信は成功し、Sent フォルダへの IMAP APPEND
  だけ失敗。相手には届いているので `warning` で知らせるだけ（未送信バッジは出さない）。
  - 根拠: SMTP が `250 OK` を返した時点で配送は保証される（RFC 5321）。Sent 保存
    （IMAP APPEND, RFC 3501）は別個の操作で、届くかどうかには関係しない。
  - Gmail / Outlook / Exchange は **サーバ側で Sent を自動保存**するため、クライアント
    側 APPEND 自体が不要（Thunderbird でもこれらは「コピーを置く」設定を切るのが推奨）。
    Asanagi の Gmail 経路（Gmail API）も APPEND は走らない。APPEND は IMAP アカウント時のみ。

## 2. 送信タイムアウト（ハング防止）

タイムアウト未設定だと、遅い/不達のサーバで送信が `maxDuration`（=30s）までハング
してから失敗する。数秒で表面化するよう明示設定した（いずれも ms）。

| 経路 | connection | greeting | socket |
|------|-----------:|---------:|-------:|
| SMTP (nodemailer) | 15,000 | 10,000 | 20,000 |
| IMAP (ImapFlow, APPEND含む) | 15,000 | 10,000 | 30,000 |
| Gmail (googleapis `messages.send`) | — | — | 20,000（`timeout`） |

nodemailer の既定は `socketTimeout = 1時間` なので、未設定だと実質ハングに見える。

## 3. ソケットエラーで落ちない（uncaughtException 対策）— PR #321

`ImapFlow` は EventEmitter。ソケットエラー（上記 `socketTimeout` 発火時の
`ETIMEOUT`「Socket timeout」など）は `'error'` イベントで通知され、**リスナが無いと
Node が uncaughtException として再送出し、最悪サーバプロセスごと落ちる**。
`connection()` で `'error'` を受けてログに留めるだけにした。実処理の `await` は別途
reject され、route の try/catch がユーザー向けメッセージに変換するので失敗通知は維持。

> 観測ログ例: `uncaughtException: Error: Socket timeout  code: 'ETIMEOUT' _connId: ...`
> 原因は網の一時断（ソケット無応答）。タイムアウト検知自体は正しい挙動で、問題は
> それが「握られず uncaughtException になる」点だった。

## 4. 控え保存の完全非同期化（案A）— 未実装・次段階

将来の改善案。SMTP 受理で即「送信済み」を返し、Sent への APPEND を完全バックグラウンド
（`after()`）で行う（Gmail/Apple Mail 型の体感）。ブロッキング APPEND は Thunderbird で
報告される「Sentへコピー中で固まる」事象の構造そのもので、避けたい。

未実装の理由: レスポンス後（バックグラウンド）に APPEND が失敗した事実を、クライアントへ
伝える「通知チャネル」が無いこと（トースト表示 `showToast` 自体はアプリに既存）。小さな
通知チャネル（例: 既存の予約ポーリングに notices を相乗り、または `/api/notices`）を足せば
実装できる見込み。現状は第2層の `warning` ＋ IMAP APPEND のタイムアウトでハングは防止済み。
Asanagi の主利用である Gmail はサーバ側 Sent 自動保存のため、そもそもこの経路を通らない。

## 5. 外部仕様メモ: Gmail / Microsoft の送信・認証変更（2025–2027）

> 調査日 2026-11-04。混同が多い領域なので一次ソースを明記する。断定部分はソース由来、
> 不確実な点は未確認と記す。

- **Gmail の 2027年1月の変更は「他アカウント連携」の話で、Gmail 自体の送信停止ではない。**
  Google 公式ヘルプによると、2027年1月に **「Send as（他アドレスとして送信）」「Gmailify」
  「POP」** のサポートが廃止される見込み。Gmail 自身の送信（API/SMTP）が止まる話ではない。
  - <https://support.google.com/mail/answer/16604719>（Gmailify / POP の今後の変更）
  - <https://support.google.com/mail/answer/17101213>（サードパーティ メールアカウント対応の変更）
- **Gmail の SMTP ベーシック認証（less secure apps）は既に終了済み**（2022〜2025 にかけて）。
  アプリパスワードは残存。OAuth2 が正規。
- **2026〜2027 の「SMTP AUTH ベーシック認証の廃止」は Microsoft(Outlook/M365) の話**で、
  Gmail ではない。M365 では 2026年末に既定無効化、2027年後半に最終廃止日を告知予定。
  - <https://www.smtp2go.com/blog/the-end-of-microsofts-basic-authentication-for-smtp-auth/>（第三者解説）

### Asanagi への影響

- **Gmail は元々 Gmail API（OAuth2）経由**（`src/lib/email/gmail.ts`、`users.messages.send`）。
  SMTP ベーシック認証・Send as・POP・Gmailify のいずれの廃止の影響も受けない＝将来も安全な方式。
  （この API 採用は上記記事への反応ではなく、スコープ/スレッド処理/パスワード非保持のための
  元からの設計。結果的に各廃止を回避している。）
- **非 Gmail は SMTP/IMAP（アプリ内接続設定の資格情報）** を使用。接続先プロバイダ側の
  認証ポリシー（例: Outlook/M365 のベーシック認証廃止）に従う必要がある。該当プロバイダを
  OAuth 必須化された場合は、その経路の対応を別途検討する。
