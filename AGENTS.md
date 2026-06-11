<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Asanagi 開発コンテキスト

AIネイティブなメールクライアント（local-first）。設計の正は [`docs/`](docs/)（00=全体, 01=添削UX, 02=重要度学習, 03=プロバイダ/同期/ネイティブ, 04=スレッド/整理）。機能の現状は [README](README.md)。

## 原則（壊してはいけないもの）

- **local-first**: メール本文・APIキー・OAuthトークンは端末外に出さない。保存先は `.data/`（gitignore済み）。シークレットをログ・APIレスポンス・コミットに出さない（設定APIはマスク返却が慣習）。
- **サーバの実メールを壊さない**: UIに完全削除は存在させない。Gmailスコープは `gmail.modify`（完全削除不可）を維持。ローカルキャッシュの間引き（`db.ts` の `prune`）はローカル行の削除のみで、プロバイダAPIを呼んではならない。
- **抽象化の継ぎ目を守る**: 機能コードは `EmailProvider`（lib/email/provider.ts）と `resolveModel()`（lib/ai/model.ts）にだけ依存。Gmail/IMAP/Claude/OpenRouter の具体を UI・APIルートに直接書かない。
- **設定の優先順位**: アプリ内設定（.data） > 環境変数 > 自動検出。

## アーキテクチャ早見

- メールID（API層）は**アカウント修飾** `{account}/{providerId}`（例 `gmail/18c…`, `imap/INBOX:5`）。`/api/emails/[id]` が分解して該当プロバイダへルーティング。返信・予約送信は元メールの `account` から送る。
- ローカルキャッシュ: `lib/db.ts`（**node:sqlite**・ビルトイン。better-sqlite3 等のネイティブ依存を足さない）。write-through＋プロバイダ障害時フォールバック。保持上限は各アカウント直近5,000通。
- 永続化: 設定・予約・学習シグナル=ローカルJSON（`lib/store.ts`）、メールキャッシュ=SQLite（`lib/db.ts`）。

## 開発の進め方（このリポジトリの合意）

1. **featureブランチ→PR**。main直push禁止。マージはオーナー（foresthill）のレビュー後。
2. **検証の型**: `npx tsc --noEmit` → `npx eslint .` → `npm run build` → 実機（Playwright で http://localhost:3100）。
3. **PR本文に検証結果を正直に書く**: 実施済み✅と未実施⚠️を区別する（例: 実IMAPサーバ未検証）。コミットメッセージは日本語で変更理由＋検証結果。
4. **devサーバはポート3100**: `PORT=3100 npm run dev`（:3000 は別アプリの stale Service Worker が居座るため使わない）。
5. **`.data/` を消さない**: 実Gmailの OAuth トークン・BYOK キーが入っている。消すと再認証が必要。テストで汚した場合は該当ファイル/行だけ掃除する。
6. UI文言は日本語、コードコメントは英語（既存スタイルに合わせる）。ファイルは300行を超えたら分割を検討（例: 接続設定は Email/Gmail/Imap セクションに分割済み）。

## 外部仕様の参照（推測で書かない）

- Gmail API スコープ/クォータ: https://developers.google.com/workspace/gmail/api/auth/scopes / .../reference/quota（標準利用は無料）
- OAuthテストステータスは refresh token **7日失効**: https://developers.google.com/identity/protocols/oauth2#expiration
- Next.js はローカルdocs（`node_modules/next/dist/docs/`）を読む（上記バナー参照）。
