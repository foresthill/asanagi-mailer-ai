# 設計書 11 — 多アカウント対応（マルチテナント）

最終更新: 2026-11-10（設計のみ・実装は v0.6 目標）

## 0. これは何か

朝凪を **複数のメールアカウント**（会社メール＝IMAP を複数、Gmail を複数、混在）に
対応させる設計。現状は Gmail 1 ＋ IMAP 1 の最大2アカウントまで。

> 要望（ユーザー）:「会社が複数、Gmail が複数あるよね。複数を管理する方法、
> マルチテナントとか」。大きいので v0.6 目標。

## 1. 現状（v0.5 系）

- `EmailSettings` は **単数** の `gmail?` / `imap?` オブジェクト（[types.ts](../src/lib/types.ts)）。
  同じ種別をもう1つ繋ぐと上書きされる。
- `active: "auto"|"gmail"|"imap"|"mock"` で1バックエンドを選択。
- `listAccounts()`（[accounts.ts](../src/lib/email/accounts.ts)）は gmail/imap/mock の
  最大3キーを返す（実質 Gmail1＋IMAP1）。
- **下地はある**: メールIDは既に **アカウント修飾** `{account}/{providerId}`
  （例 `gmail/18c…`, `imap/INBOX:5`）。`/api/emails/[id]` が分解してルーティングし、
  返信・予約は元メールの `account` から送る（[AGENTS.md](../AGENTS.md)）。
  → ID スキームは多アカウントを既に想定済み。ネックは「アカウント＝固定の
  gmail/imap キー」という**設定とプロバイダ解決の単数前提**だけ。

## 2. 目標と非目標

**目標**
- 任意個のアカウント（IMAP 複数社・Gmail 複数・混在）を追加／編集／削除できる。
- 統合受信箱（全アカウント横断）＋アカウント別フィルタ。
- アカウントごとに表示開始日・署名・AIメモ等の既存の per-account 設定を保持。

**非目標（この設計では扱わない）**
- 複数ユーザー間の共有（これは [docs/10](10-learning-layers.md) のチーム共有の範疇）。
- サーバ集中管理（local-first を維持。アカウント資格情報は端末内 `.data` のみ）。

## 3. データモデル変更

単数 `gmail`/`imap` → **アカウント配列**へ。後方互換のため旧フィールドからの
マイグレーションを噛ませる。

```ts
interface MailAccount {
  id: string;        // 安定キー（例 "gmail-1699999999" / "imap-acme"）。ID修飾に使う
  type: "gmail" | "imap";
  label: string;     // 表示名（例 "会社(Acme)" "個人Gmail"）
  address?: string;  // 表示用アドレス
  // 以降は type 別の資格情報（現在の gmail/imap オブジェクトと同じ中身）
  gmail?: { clientId; clientSecret; refreshToken; ... };
  imap?: { host; port; user; password; smtp...; folders... };
  inboxCutoff?: string;   // アカウント別の表示開始日（既存踏襲）
  fromName?: string;      // 送信表示名（既存踏襲）
}
interface EmailSettings {
  accounts?: MailAccount[];     // 新: 正。空/未定義 → mock
  activeAccountId?: string | "all"; // 表示対象（"all"=統合）。既存 active の後継
  // 旧 gmail?/imap?/active は読み取り専用の後方互換（起動時に accounts へ移行）
}
```

- **`account` 修飾子 = `MailAccount.id`**（今は "gmail"/"imap" 固定 → 任意idへ）。
  既存IDとの互換のため、移行アカウントは `id: "gmail"` / `id: "imap"` を維持すると
  キャッシュ（`asanagi.db` の account 列）・下書き・予約の既存行が壊れない。

## 4. 解決層・API の変更

- `listAccounts()` → `accounts` 配列をそのまま返す（mock フォールバックは維持）。
- `getProviderFor(key)` → `key = account.id` で該当 `MailAccount` を引き、type に応じた
  Provider を生成（現行 switch を id ルックアップに置換）。
- `loadActiveProvider()`（単数前提の解決）→ 廃止 or 「統合時は全アカウント束ね」。
  一覧取得は**各アカウントの `listIds` を並行取得してマージ**（日時降順）。
- 返信/予約送信は従来どおり元メールの `account`(=id) の Provider から送る（無改修で効く）。

## 5. UI の変更

- 接続設定: 「メールの接続方法」単一ピッカー → **アカウント一覧＋「＋追加」**。
  各行に type/label/アドレス/接続状態、編集・削除。追加は Gmail か IMAP を選んで接続。
- サイドバー: 「すべて（統合）」＋**アカウント別セクション**（既存の g1989n@/morioka@ の
  並びを N 個へ一般化）。`emailConfigured` は「accounts に mock 以外が1つでもあるか」。
- トグル渋滞を避ける（[UIツールバー方針メモ](memory)）: アカウント切替は1つのセレクタに集約。

## 6. マイグレーション（壊さない）

1. 起動時、`accounts` が無く旧 `gmail`/`imap` があれば **accounts[] に変換**
   （id は "gmail"/"imap" を踏襲＝既存キャッシュ・ID と互換）。書き戻して以後は accounts が正。
2. 旧フィールドは当面読み取り互換で残し、数バージョン後に撤去（expand-contract）。
3. `asanagi.db` の `account` 列はそのまま（id 互換なので再取得不要）。

## 7. local-first / 不変条件

- 資格情報・トークンは引き続き端末内 `.data` のみ。アカウントが増えても端末外に出さない。
- 保持上限は**アカウント別に 5,000 通**（既存 `RETENTION_PER_ACCOUNT` はそのまま効く）。
- Gmail は依然 `gmail.modify`（完全削除不可）。prune はローカル行のみ（[AGENTS.md](../AGENTS.md)）。

## 8. 段階実装（v0.6）

1. **Phase 1**: データモデル＋マイグレーション＋解決層（accounts 配列化）。UI は現状維持で
   内部だけ多アカウント化（旧2アカウントが accounts[2] として動く＝回帰ゼロを確認）。
2. **Phase 2**: 接続設定の「アカウント一覧＋追加/削除」UI。
3. **Phase 3**: サイドバーのアカウント別セクション＋統合マージの並行取得最適化。

## 9. リスク

- ID 修飾の互換（既存 `asanagi.db` / 下書き / 予約の `account` 値）を壊さないこと＝
  移行アカウントの id 踏襲が必須。
- 統合取得の N 並行化でレート/負荷増 → アカウント別に `listIds` 上限（既存400）を維持。
- Gmail 複数は BYO OAuth クライアントを各アカウントで持つ（client/secret/refresh を個別保存）。
