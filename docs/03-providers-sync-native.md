# 設計書 03 — メールプロバイダ・同期戦略・Macネイティブ

最終更新: 2026-06-03

## 1. プロバイダ・ロードマップ

| フェーズ | プロバイダ | 位置づけ |
|----------|-----------|----------|
| Phase 1 | **Gmail API (OAuth2)** | 個人Gmailで体験確立 |
| Phase 2 | **IMAP / SMTP（汎用）** | **本命の会社メール**。Macネイティブと同時期 |
| Phase 2+ | 複数アカウント | Gmail＋会社IMAPを1画面で |

両者は既存の `EmailProvider` インターフェース（`src/lib/email/provider.ts`）に実装済み。本書は主に**同期戦略**を定義する。

---

## 2. 同期の大原則 — 新着のみ（forward-only）

> ユーザー方針: Gmailは8万通超。**過去は backfill せず、接続時点以降の新着のみ**取り込む。

**「接続時点」をベースラインとして記録し、それより前は無視する。** 必要なら「過去N日だけ取り込む」をオプション提供。

```
接続時
  ├─ ベースライン記録（Gmail: 現在の historyId / IMAP: 現在の UIDNEXT・HIGHESTMODSEQ）
  └─ （任意）直近N日だけ初期取り込み
以降
  └─ ベースラインから前方差分のみ同期
```

---

## 3. Gmail 同期設計（Phase 1）

### 3.1 forward-only の実現
- 初回接続で**バックフィルしない**。代わりに現在の `historyId` を保存（プロファイル取得 or 最新1通から取得）。
- 以降は **`users.history.list?startHistoryId=<保存値>`** で差分のみ取得（partial sync）。
- 注意: `historyId` は通常**1週間以上有効**だが、まれに数時間で失効する。失効時は full sync が必要になるが、本アプリは「新着のみ」方針なので、**失効時は最新の historyId を取り直してベースラインを更新するだけ**（過去を遡らない）でよい。

### 3.2 リアルタイム通知（ポーリング不要）
- **`users.watch`** で Gmail → **Cloud Pub/Sub** にプッシュ購読。変更時にwebhookが飛び、`message.data`（base64url）に新しい `historyId` が入る → それで partial sync。
- `watch` は有効期限があるため**定期的に再 watch**（cron）。
- Pub/Sub未設定の環境向けに**ポーリング fallback**（数十秒間隔で history.list）も用意。

### 3.3 同期状態
```ts
interface GmailSyncState {
  accountId: string;
  baselineHistoryId: string;   // 接続時点 = これ以前は取り込まない
  lastHistoryId: string;       // 最後に同期できた地点
  watchExpiration?: string;
}
```

**出典（Gmail）**:
- [Synchronize clients with Gmail（full/partial sync, historyId保存）](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Method: users.history.list（startHistoryId）](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)
- [Push Notifications（watch + Pub/Sub で partial sync をトリガ）](https://developers.google.com/workspace/gmail/api/guides/push)
- [Method: users.watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch)

---

## 4. IMAP/SMTP 同期設計（Phase 2・会社メール＝本命）

### 4.1 forward-only の実現
- フォルダ選択時の **`UIDNEXT`** を接続ベースラインとして記録 → **`UID >= baseline` のみ取得**（過去メールは取り込まない）。
- メッセージ識別は **`UID` + `UIDVALIDITY`**。サーバが `UIDVALIDITY` を変えたら（再構築等）UIDは無効化されるので、ベースラインを取り直す。

### 4.2 効率的な差分・フラグ同期
- サーバが対応していれば **CONDSTORE / QRESYNC（RFC 7162）** を使う:
  - `SELECT ... (QRESYNC (uidvalidity highestmodseq))` で、再接続時に**追加のサーバ状態やラウンドトリップなしで**変更（新着・フラグ変更・削除）をまとめて取得。
  - 同期状態 = フォルダごとの **`UIDNEXT` と `HIGHESTMODSEQ`**。UID < UIDNEXT は取得済み、MODSEQ <= HIGHESTMODSEQ はメタデータ同期済み、とみなせる。
- 非対応サーバ向け fallback: `UID SEARCH`＋フラグ差分の素朴同期。

### 4.3 リアルタイム通知
- **IMAP `IDLE`（RFC 2177）** で接続を張りっぱなしにし、新着をサーバからプッシュ受信（ポーリング不要）。
- `IDLE` 非対応なら短間隔ポーリング。

### 4.4 同期状態
```ts
interface ImapFolderSyncState {
  accountId: string;
  folder: string;
  uidValidity: number;
  baselineUidNext: number;     // 接続時点 = これ以降のUIDのみ
  lastSeenUid: number;
  highestModSeq?: number;      // CONDSTORE/QRESYNC 対応時
}
```

**出典（IMAP）**:
- [RFC 7162 — CONDSTORE / QRESYNC（追加状態・ラウンドトリップなしの再同期, HIGHESTMODSEQ）](https://www.rfc-editor.org/rfc/rfc7162.html)
- RFC 3501 — IMAP4rev1（UID, UIDVALIDITY, UIDNEXT, STATUS）
- RFC 2177 — IMAP IDLE（プッシュ受信）

> 既存の `imapflow` は CONDSTORE/QRESYNC/IDLE を扱える。Phase 2 で同期エンジンとして組み込む。

---

## 5. ローカルファースト同期アーキテクチャ（Phase 2）

会社メール＋Macネイティブに向け、**ローカルSQLiteを正本**にする。

```
┌────────────┐    sync engine     ┌──────────────┐
│  サーバ      │ ◀───────────────▶ │ ローカルSQLite │ ◀─ UI（即時・オフライン可）
│ Gmail/IMAP  │  forward-only       │ (正本)        │
└────────────┘  push(watch/IDLE)   │ + ベクトル     │ ◀─ 学習(層1/3)・埋め込み
                                    │ (sqlite-vec)  │     も同一DB・端末内
                                    └──────────────┘
```
- メール本文・学習データ・埋め込みは**端末内**で完結（プライバシー＝企業導入の前提、[02](02-importance-triage-learning.md)・PIIマスキングと整合）。
- オフラインでも閲覧・下書き・予約ができ、オンライン時に同期。

---

## 6. Macネイティブ化（Phase 2/3）

Webの資産（React UI・APIロジック）をどこまで再利用するかが論点。

| 選択肢 | UI再利用 | ネイティブ統合(通知/常駐/メニューバー) | ローカルLLM | 配布サイズ | 開発速度 | 判定 |
|--------|---------|--------------------------------|------------|-----------|---------|------|
| **Tauri** | ◎ 既存React UIをほぼ流用 | ○（通知・トレイ・自動起動API有） | ○ Rust側でllama.cpp/ortバインド | 小（数十MB） | 速 | **推奨（第一候補）** |
| **SwiftUI ネイティブ** | ✗ UI作り直し | ◎ 最良（Mail同等の体験・APNs等） | ◎ MLX/CoreMLで最適 | 小 | 遅 | 体験最優先なら |
| Electron | ◎ | ○ | △ | 大（百MB超） | 速 | 非推奨（重い） |

**推奨**: **Tauri**。
- 既にあるReact UI（受信箱・添削・仕分け）を**そのまま流用**でき、Rustバックエンドで IMAP同期・ローカルSQLite・ローカル埋め込み/LLM を担える。
- ネイティブ通知・メニューバー常駐・バックグラウンド同期に対応。
- 配布が軽い。

**SwiftUIを選ぶ条件**: Apple純正Mailに匹敵する深いOS統合（システム通知の細やかさ、共有シート、Handoff、省電力な常駐）を最優先する場合。その場合UIは作り直しだが、APIロジック（同期・AI抽象化）はサーバ/ローカルサービスとして共有可能。

> 判断ポイント（要相談）: 「UI資産の再利用速度（Tauri）」 vs 「最高のMac体験（Swift）」。本命が会社利用なら、まず**Tauriで早く実機検証 → 必要に応じてSwift**が現実的。

---

## 7. 受け入れ基準

- [ ] Gmail接続時に過去8万通を取り込まず、接続以降の新着のみ表示される
- [ ] Gmail: watch/Pub/Sub（or ポーリング）で新着がリアルタイム反映
- [ ] IMAP接続時に `UIDNEXT` ベースライン以降のみ取得（過去を遡らない）
- [ ] IMAP: IDLE で新着プッシュ、QRESYNC対応サーバで効率再同期
- [ ] ローカルSQLiteが正本となり、オフライン閲覧・下書きが可能（Phase 2）
- [ ] Macアプリ（Tauri）で通知・常駐・バックグラウンド同期が動作（Phase 2）

## 8. 決定事項
1. **【決定】ネイティブ化は Tauri 先行**（UI流用で早く実機検証 → 必要に応じて Swift）。
2. **【決定】Gmail接続: 既定は新着のみ。加えて「直近 N 日も初期取り込み」をオプション提供**（重要メールが直近にある場合に備える）。`N` はUIで選択（例: 7 / 30 / 90日）。
3. （未定）ローカル埋め込みモデルの選定（サイズ vs 精度）。Phase 2着手時にベンチ。
