# 設計書 05 — カレンダー連携（招待メール → 会議カード → Googleカレンダー登録）

最終更新: 2026-06-12（初版）

## 0. スコープ宣言 — これは「カレンダー機能」ではない

> 「コレ面白いけど越境じゃないよね？このシステムでの守備範囲と見ても良いかな？」（オーナー, 2026-06-12）

**守備範囲内**。理由: 会議招待（Teams / Google Meet / Zoom）は `text/calendar`（.ics）という
MIMEパートや本文URLとして**メールで届く**。これを理解して処理するのは「カレンダー機能」では
なく、**届いたメールを正しく読解してさばく**というメールクライアントの本務である
（Outlook / Gmail が招待メールを会議カード表示するのと同じ層）。「受信箱が澄む」の文脈では、
要対応メールの代表格である招待を「カードで把握 → ワンクリック登録 → アーカイブ」でさばけるようにする。

**やること（橋渡しまで）**

- 受信メール内の会議招待の**検出**
- リーダー上部での**会議カード表示**（タイトル・日時・場所・主催者・参加URL）
- 既存カレンダーへの**登録**（Googleカレンダー・ワンクリック）
- 参加URL（Teams/Meet/Zoom）の**ワンクリックで開く**

**やらないこと（ここからは越境）**

- ❌ 月表示などのフルカレンダーUI（カレンダーアプリの領分）
- ❌ 日程調整ツール化（空き時間提案・調整リンク発行 — Calendly等の領分）
- ❌ 出欠返信（iTIP REPLY）— 越境ではないが初期スコープ外（§7）

## 1. 体験

```
┌─ リーダー（招待メールを開いたとき）─────────────────────────┐
│ 📅 定例ミーティング                                        │
│    6月22日(月) 17:00–18:00                                  │
│    場所: Microsoft Teams 会議                               │
│    主催: 下平奨 <s-shimohira@…>                             │
│    [Googleカレンダーに登録]  [会議に参加 ↗]                 │
└─────────────────────────────────────────────────────────────┘
```

- 招待を含むメールを開くと、本文の上に**会議カード**。
- **登録**ボタン → ユーザーのGoogleカレンダーへ即登録 → ボタンが「登録済み ✓」に変化。
- **参加**ボタン → 会議URL（Teams/Meet/Zoom）を新規タブで開く。
- 一覧の行には📅マーク（会議招待であることが開く前から分かる）。

## 2. 検出と解析

### 2.1 検出（2段構え）

| 優先 | 方法 | 取れる情報 |
|------|------|-----------|
| 1 | **`text/calendar` MIMEパート**（.ics添付含む） | タイトル・開始/終了・場所・主催者・UID — 構造化された全情報 |
| 2 | 本文URLパターン（`teams.microsoft.com/l/meetup-join`・`meet.google.com/xxx`・`zoom.us/j/xxx`） | 参加URLのみ（日時なしの簡易カード） |

- Teams / Google カレンダー / Zoom の招待メールは通常 METHOD:REQUEST の
  `text/calendar` パートを含む（[RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545) /
  [RFC 5546 iTIP](https://datatracker.ietf.org/doc/html/rfc5546)）。
- 抽出位置はprovider層: Gmail = payloadパート走査（`findPart`の拡張）、
  IMAP = mailparserの添付/calendarパート。**機能コードはEmail型だけを見る**（継ぎ目維持）。

### 2.2 データモデル

```ts
/** Parsed meeting invite (from text/calendar or body URLs). */
interface MeetingInvite {
  uid?: string;          // iCalUID — 重複登録防止の鍵
  summary?: string;      // タイトル
  start?: string;        // ISO 8601
  end?: string;          // ISO 8601
  location?: string;
  organizer?: EmailAddress;
  joinUrl?: string;      // Teams/Meet/Zoom参加URL
  method?: string;       // REQUEST / CANCEL（CANCELは「中止」表示）
  raw?: string;          // 元ICS（登録時にimportへ渡す用・キャッシュには保存しない）
}
// Email に invite?: MeetingInvite を追加（一覧ペイロードでは uid/summary/start のみの軽量版）
```

### 2.3 ICSパーサ

- **依存ゼロの自前ミニパーサ**（`lib/email/ics.ts`）。VEVENT の
  SUMMARY / DTSTART / DTEND / LOCATION / ORGANIZER / UID / METHOD のみ対象。
- 行折返し（RFC 5545 §3.1の75オクテット折返し）と `TZID=Asia/Tokyo` / UTC(`Z`) / 終日(`VALUE=DATE`)
  の日時を処理。**RRULE（定期会議）は初期スコープ外** — カードに「定期」とだけ表示し、登録は初回分（§7）。

## 3. Googleカレンダーへの登録

- API: **`events.import`**（[リファレンス](https://developers.google.com/workspace/calendar/api/v3/reference/events/import)）。
  `iCalUID` を必須で受け取るため、**同じ招待を二度登録しても重複しない**（同一UIDは同一イベント）。
  ICSのない簡易カード（URLのみ）は `events.insert` でフォールバック。
- スコープ: 既存のGmail OAuthクライアントに
  **`https://www.googleapis.com/auth/calendar.events`**（イベントの表示・編集）を追加
  （[Calendar API auth guide](https://developers.google.com/workspace/calendar/api/auth)）。
  カレンダー全体の管理権限（`auth/calendar`）は取らない — 最小権限。
- **再認証が1回必要**: スコープ追加後、接続設定の「Googleで認証して接続」を押し直す。
  未再認証のまま登録を押した場合は権限エラーを検知して再認証へ誘導する。
- 会社メール（IMAP）で受けた招待も登録先は同じGoogleカレンダー（ユーザーのカレンダーは1つ、という運用前提）。
  Google未接続環境では登録ボタンを無効化し「Google接続が必要」と表示。

## 4. アーキテクチャ整合

- 解析は**完全にローカル**（local-first維持）。外に出るのは登録時の `events.import` 1回のみで、
  宛先はユーザー自身のGoogleカレンダー。
- `invite` はSQLiteキャッシュに**保存しない**（rawのICSが大きく、live fetchで毎回取れるため）。
  一覧の📅マーク用に `has_invite` フラグのみ保存を検討（§7）。
- APIルート: `POST /api/calendar/add`（body: メールID）→ サーバ側で当該メールのICSを再取得して登録
  （クライアントからICS本体を往復させない）。

## 5. 受け入れ基準

- [ ] text/calendar付きの実招待メール（Teams/Googleカレンダー発）がカード表示される（タイトル・日時・主催・参加URL）
- [ ] 「Googleカレンダーに登録」でユーザーのカレンダーに予定が入り、ボタンが登録済みになる
- [ ] 同じ招待を二度登録してもカレンダー上で重複しない（iCalUID）
- [ ] METHOD:CANCEL の招待は「この会議は中止されました」表示になる
- [ ] ICSなし・参加URLのみのメールでも簡易カード（参加ボタンのみ）が出る
- [ ] Google未接続/スコープ未付与時に適切な誘導が出る
- [ ] 日本時間（TZID）・UTC・終日イベントの日時が正しく表示される

## 6. 段階導入

1. **Phase 1**: ICS解析＋会議カード＋events.importによる登録＋参加URL（本書の主対象）
2. **Phase 2**: 一覧の📅マーク、RRULE（定期会議）の表示改善、URLのみメールの日時AI抽出
3. **Phase 3（要相談）**: 出欠返信（iTIP REPLY送信）— Teamsの主催者側に出欠が反映される

## 7. オープンな決定事項

1. RRULE（定期会議）の登録: 初回のみ登録 vs RRULEごとimport（GoogleはRRULE取り込み可能 — 実装時に検証）
2. 一覧📅マークのためのキャッシュフラグ（has_invite カラム）を足すか
3. 出欠返信（Phase 3）をどこまでやるか — REPLYのiTIPメール送信はメーラーの本務range内ではある

## 出典

- [RFC 5545 — iCalendar](https://datatracker.ietf.org/doc/html/rfc5545) / [RFC 5546 — iTIP](https://datatracker.ietf.org/doc/html/rfc5546)
- [Google Calendar API: events.import](https://developers.google.com/workspace/calendar/api/v3/reference/events/import) / [auth guide（スコープ一覧）](https://developers.google.com/workspace/calendar/api/auth)
