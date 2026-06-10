# Asanagi（朝凪）

> 朝、受信箱が澄んでいる。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Status: Phase 1 MVP](https://img.shields.io/badge/status-Phase%201%20MVP-orange)
![Maintenance: as-is](https://img.shields.io/badge/maintenance-as--is%20%2F%20no%20support-lightgrey)
![Next.js](https://img.shields.io/badge/Next.js-16-black)

AIネイティブ・AIファーストなメールクライアント。受信したメールに対してAIが返信下書きを提案し、**会話で一箇所ずつ添削**しながら、**即時送信**または**スケジュール送信**できます。さばいたメールはアーカイブ／ゴミ箱へ送って受信箱をきれいに保ちます。重要度はAIが判定し、あなたのフィードバックを学習していきます。

**Asanagi（朝凪）** = 朝、海風がやんで波が静まる凪。一日の始まりに、受信箱が澄みきっている状態を名前にしました。

> ステータス: **Phase 1 MVP（動作確認済み）**。APIキーなしでもモックの受信箱で全機能を試せます。

## 主な機能（Phase 1）

- **受信箱 / アーカイブ / ゴミ箱** — 3ペインUI、ホバー＆キーボードで素早く処理
- **AIで返信** — 受信メールから返信下書きを自動生成
- **会話で添削** — 「もっと丁寧に」「日程を月曜に」などと指示すると下書きに反映（ストリーミング）
- **即時送信 / スケジュール送信** — 1時間後・明日朝・任意日時を指定可能
- **送信＆アーカイブ** — 返信したら元メールを自動でアーカイブ（受信箱を片付ける）
- **AI重要度判定 + 学習** — high/normal/low を判定。`重要/通常/低` のフィードバックがその送信者・ドメインのシグナルとして蓄積され、次回以降の判定に反映（per-userナレッジの種）
- **キーボード操作** — `j`/`k` 移動、`e` アーカイブ、`r` 返信、`#`/`Backspace` ゴミ箱

## アーキテクチャ（差し替え可能な抽象化）

| 層 | 抽象化 | 実装 |
|----|--------|------|
| AI | `src/lib/ai/model.ts` | Claude（Anthropic）/ OpenAI / OpenRouter / Vercel AI Gateway を切替。**アプリ内 設定画面（BYOK）** または env で指定（設定がenvに優先）。将来ローカルLLMも追加可 |
| Email | `src/lib/email/provider.ts` | Gmail API / 汎用IMAP+SMTP / モック（資格情報なしで動く）を自動判定 |
| 永続化 | `src/lib/store.ts` | ローカルJSON（`.data/`）。Phase2でDBに差し替え予定 |

機能コード（UI / APIルート）はこれらのインターフェースだけに依存し、Gmail/IMAPやClaude/OpenRouterの具体に直接依存しません。

## セットアップ

```bash
npm install
npm run dev            # http://localhost:3000
```

キーなしでもモック受信箱で全フローを試せます（返信生成・重要度はキーワードベースの簡易モード）。

### AI・メールを実接続する

**AIキーは2通りで設定できます。**

1. **アプリ内（BYOK・推奨）** — 起動後、左サイドバー下部の「AI 接続設定」からプロバイダ（OpenRouter / Claude / OpenAI / Gateway）を選び、APIキーとモデルIDを入力。「接続テスト」で疎通確認できます。キーは**この端末のローカル（`.data/`）にのみ保存**され、env より優先されます。
2. **環境変数** — `.env.example` を `.env.local` にコピーして設定:

```bash
# AIプロバイダ（いずれか）
ANTHROPIC_API_KEY=sk-ant-...        # Claude直接（推奨）
# OPENROUTER_API_KEY=sk-or-...      # OpenRouter
# AI_GATEWAY_API_KEY=...            # Vercel AI Gateway
AI_PROVIDER=anthropic
# AI_MODEL=claude-sonnet-4-5        # 利用プロバイダの最新モデルIDを指定

# メールバックエンド（いずれか。未設定ならモック）
# Gmail (OAuth2): GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
# IMAP+SMTP:      IMAP_HOST / IMAP_USER / IMAP_PASSWORD / SMTP_HOST ...
```

> モデルIDは変わるため、`AI_MODEL` には利用プロバイダが現在公開しているIDを設定してください。

### Gmail をアプリ内から接続する（推奨・5分）

自分専用の OAuth クライアント（BYOクライアント）を1回作れば、以後はアプリ内のボタンだけで接続できます。メールは**オンデマンド取得（直近50件/フォルダ）**で、端末へ全件ダウンロードはしません。トークンはローカル（`.data/`）にのみ保存されます。

1. [Google Cloud Console](https://console.cloud.google.com/) → プロジェクト作成（既存でも可）
2. 「APIとサービス → ライブラリ」で **Gmail API を有効化**
3. 「APIとサービス → OAuth同意画面」→ User Type **外部** → アプリ名等を入力 → **テストユーザーに自分の Gmail アドレスを追加**
4. 「認証情報 → 認証情報を作成 → **OAuth クライアント ID**」→ 種類 **ウェブアプリケーション** → 承認済みリダイレクトURIに以下を追加:
   - `http://localhost:3000/api/auth/google/callback`
   - （別ポートで動かすなら `http://localhost:3100/api/auth/google/callback` も）
5. 発行された**クライアントID / シークレット**を、アプリの「接続設定 → メールアカウント（Gmail）」に貼り付け → **「Google で認証して接続」** → 同意画面で許可

要求スコープは `gmail.modify` のみ（読む・送る・アーカイブ/ゴミ箱。**完全削除は不可**）。
出典: [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

> ⚠️ OAuth同意画面が「テスト」ステータスの場合、Googleの仕様で**リフレッシュトークンが7日で失効**します（再接続すれば復旧）。長く使う場合は同意画面を「本番」に公開してください（未審査でも自分用なら警告画面を経て利用可）。
> 出典: [Using OAuth 2.0 — Refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

## スクリプト

```bash
npm run dev      # 開発サーバ
npm run build    # 本番ビルド（型チェック込み）
npm run lint     # ESLint
```

## 設計書（docs/）

実装の前提となる設計は [`docs/`](docs/) にあります。

- [00 — 全体概要・フェーズ・原則](docs/00-overview.md)
- [01 — 逐次的な返信添削UX（一箇所ずつ提案→採用/却下）](docs/01-incremental-reply-editing.md)
- [02 — 重要度の仕分け画面とユーザーごとの学習機構](docs/02-importance-triage-learning.md)
- [03 — プロバイダ・同期戦略（新着のみ）・Macネイティブ](docs/03-providers-sync-native.md)
- [04 — スレッド表示とインボックス整理（バンドル/ビュー）](docs/04-threads-and-organization.md)

## ロードマップ

- **Phase 1** — Gmail API・AI返信＋添削・重要度判定＋学習・送信/予約・アーカイブ/ゴミ箱（Web）
- **Phase 2** — IMAP/SMTP（会社メール）、**Macネイティブ（Tauri想定）**、**スレッド表示**、**インボックス整理（バンドル/送信者レーン/スマートビュー）**、PIIマスキング、ローカルLLM/ローカル学習、新着のみ同期
- **Phase 3** — **承認ワークフロー**（上長レビュー → 送信）、重要度学習の高度化（埋め込みRAG＋軽量分類器）

## 技術スタック

Next.js 16 (App Router) / React 19 / Tailwind CSS v4 / Vercel AI SDK v6 / TypeScript

## プロジェクトの状態 / サポート方針

- **個人プロジェクトです。現状有姿（as-is）で提供**し、**能動的なサポートは行いません**。
- **自由に使って、フォークして、自分で直してください。** それが推奨スタンスです。
- Issue / 機能要望 / 修正依頼への返信は**保証しません**（見られないこともあります）。
- 改善を共有したい方は PR を歓迎しますが、レビュー・マージも保証はありません。気軽にフォークしてどうぞ。

## ライセンス

[MIT License](LICENSE) © 2026 foresthill

自由に利用・改変・再配布・商用利用（SaaS化を含む）して構いません。無保証です。
