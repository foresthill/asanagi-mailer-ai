# 07 — 外部ツール連携（インテグレーション）

TODO やメールを外部のプロジェクト管理・カレンダーへ橋渡しする。母体は
[TODO](04-threads-and-organization.md) と、メール（本文ツールバー）。設定は
すべてサイドバー「連携」→ 各カードの「接続する」から行える。接続状況の一覧は
「連携」画面（`IntegrationsView`）で確認できる。

## 原則（local-first）

- 接続情報（URL・APIトークン・アプリパスワード）は端末内のみ（`.data/*-settings.json`）。
  learning-history の allowlist 外なので git 追跡されず、設定 API はマスクして返す
  （`{ set: true, last4 }` のみ）。
- 送信は**明示操作のときだけ**。起票ボタン／カレンダー追加を押した時に、対象の
  件名・差出人・本文抜粋・期限が**そのユーザー自身のインスタンス**へ渡る（AI
  プロバイダではないので PII マスクはしない＝タスクとして意味を保つ）。
- 「連携」画面には**実際に動く連携だけ**を並べる（未実装のプレースホルダは置かない）。

## 一覧

| 連携 | 種別 | できること | 認証 |
|---|---|---|---|
| OpenProject | REST v3 | TODO/メール→work package 起票、自分の未完了WPを一覧(pull) | API トークン |
| devlog | MCP | TODO/メール→issue 起票、未完了issueを一覧(pull) | MCP トークン(`dvlg_`) |
| Nextcloud | CalDAV | TODOの期限→カレンダー予定 | ユーザー名＋アプリパスワード |
| Google カレンダー | Google API | TODOの期限→カレンダー予定 | 既存の Gmail OAuth を再利用 |

---

## OpenProject

TODO・メールを work package として起票し、既定プロジェクトの「自分の未完了 WP」を
TODO 画面に読み取り表示する。

**トークンの取得**: OpenProject 右上のアバター → *My account* → *Access tokens* →
*API* でトークンを生成。

**設定手順**（連携 → OpenProject → 接続する）:
1. インスタンス URL（例 `https://openproject.example.com`）
2. API トークンを貼り付け
3. 「接続してプロジェクト取得」→ 既定プロジェクトを選択
4. 「保存」

**使い方**: TODO 行／メール本文ツールバーの起票ボタン → work package 作成 → 別タブで
開く。TODO には id/URL が紐づき、二重起票を防ぐ。TODO 画面下部に「自分の未完了 WP」。

**実装**: `lib/integrations/openproject.ts`（Basic 認証 `apikey:token`・
`GET /api/v3/projects`・`POST /api/v3/projects/{id}/work_packages`・type は
project の types から自動選択）、`/api/integrations/openproject{,/projects,/send,/pull}`。

---

## devlog（自作ツール・MCP 経由）

devlog には外部から叩けるトークン認証の REST API が無く、認証の入口は **MCP
エンドポイント**（`/api/mcp`・`Authorization: Bearer dvlg_…`）のみ。そのため
Asanagi は `@modelcontextprotocol/sdk` の Streamable HTTP クライアントとして devlog の
MCP ツール（`list_projects` / `create_issue` / `list_issues`）を呼ぶ。devlog 側の
改修は不要。

**トークンの取得**: devlog のプロジェクト設定（プロジェクト ADMIN）で MCP トークン
（`dvlg_…`）を発行。ユーザースコープのトークンなら、送信のたびに projectKey を渡す
（Asanagi は既定プロジェクトを保存しておく）。

**設定手順**（連携 → devlog → 接続する）:
1. devlog の URL（例 `https://devlog-mu.vercel.app`）
2. MCP トークン（`dvlg_…`）を貼り付け
3. 「接続してプロジェクト取得」→ 既定プロジェクトを選択
4. 「保存」

**使い方**: 起票ボタン → issue 作成（`PROJECTKEY-123`）→ 別タブで開く
（`{base}/projects/{key}/issues/{key}`）。TODO 画面下部にプロジェクトの未完了 issue。
※ devlog MCP に「自分の担当」フィルタが無いため、pull はプロジェクトの open issue を表示。

**実装**: `lib/integrations/devlog.ts`（MCP client）、
`/api/integrations/devlog{,/projects,/send,/pull}`。

---

## Nextcloud（CalDAV）

TODO の期限を Nextcloud カレンダーの予定として登録する。

**アプリパスワードの取得**: Nextcloud の *設定 → セキュリティ → デバイス＆セッション*
（アプリパスワード）で新規発行。**通常のログインパスワードではない。**

**設定手順**（連携 → Nextcloud → 接続する）:
1. Nextcloud の URL（例 `https://cloud.example.com`）
2. ユーザー名
3. アプリパスワードを貼り付け
4. 「接続してカレンダー取得」→ 登録先カレンダーを選択
5. 「保存」

**使い方**: 期限を設定した TODO 行にカレンダー追加ボタンが出る。押すと VEVENT を
その日時（30分枠）で作成。UID を TODO に紐づけるので、再登録は上書き（重複しない）。

**実装**: `lib/integrations/nextcloud.ts`（`listCalendars`=PROPFIND / `createEvent`=
`.ics` を PUT）、`/api/integrations/nextcloud{,/calendars,/add}`。PROPFIND の XML は
Nextcloud の標準出力を正規表現で解析（XML 依存を足さない）。

---

## Google カレンダー

TODO の期限を Google カレンダー（primary）の予定として登録する。招待メール→カレンダー
登録（[docs/05](05-calendar-bridge.md)）と同じ Gmail OAuth・googleapis を再利用する。

**前提**: Gmail（Google）が接続済みであること（連携ハブで「接続済み」表示）。加えて
Google Cloud 側で **Google Calendar API を有効化**し、カレンダー権限スコープが必要。
権限不足のときは 403 を返し、UI が再認証（接続設定の「Google で認証して接続」を
やり直す）へ誘導する。

**使い方**: 期限付き TODO のカレンダー追加ボタン → 予定作成。Nextcloud と両方
設定している場合は、ボタンから宛先（Nextcloud / Google）を選ぶ小メニューが出る。
`iCalUID = asanagi-todo-{id}` で再登録は上書き（重複しない）。

**実装**: `/api/calendar/status`（Gmail 接続の有無＝可否）、`/api/calendar/add-todo`
（`events.import`）。

---

## 連携画面の多言語

「連携」画面と各接続設定セクションは 4 言語（日本語 / English / Français / 中文）に
対応。海外メンバーでもセットアップできる。ブランド名・技術トークン
（Gmail・IMAP/SMTP・`dvlg_`・ポート番号・callback URL 等）は非翻訳のまま。

## 検証状況（重要）

各連携のクライアントは公式仕様／実ソースの契約どおりに実装し、ダミー接続で実サービスへ
到達すること（認証拒否・接続エラーが graceful に返ること）まで確認済み。ただし
**実トークン/アプリパスワードでの実起票・実登録（happy-path）は、接続情報を設定した
上での実地確認が必要**。設定後、少量で 1 件ずつ試してから本格運用すること。
