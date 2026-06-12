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

- **受信箱 / アーカイブ / ゴミ箱** — 3ペインUI、ホバー＆キーボードで素早く処理。**アーカイブ・ゴミ箱はサーバにも反映**されます（Gmail＝ラベル操作、IMAP＝フォルダ移動。他のメーラーから見ても同じ状態）。**完全削除はUIに存在しません**（Gmailスコープも `gmail.modify` で完全削除不可）— ゴミ箱からはいつでも受信箱に戻せます
- **スレッド（会話）** — 一覧では**1会話=1行**（件数バッジ＋参加者連名、Gmail型フラット集約）。開くと時系列カードまたは**LINE風バブル**（自分=右）で会話全体を表示。アーカイブ/ゴミ箱は**会話単位**（ヘッダのトグルで個別表示にも切替可）。返信はGmail/IMAPともサーバ側スレッドに正しく参加します。**転送（Fwd:）は仕様として新しい会話**になります（宛先が変わる別のやりとりのため、意図的にスレッド情報を付けません — [docs/04 §1.5](docs/04-threads-and-organization.md)）
- **AIで返信 / 全員に返信 / 転送** — 返信下書きの自動生成。転送はAIが要点まとめ付きの前置き文を作成
- **会話で添削** — 「もっと丁寧に」「日程を月曜に」などと指示すると差分提案として下書きに反映。**件名が未入力なら件名も提案**
- **即時送信 / スケジュール送信** — 1時間後・明日朝・任意日時を指定可能
- **送信＆アーカイブ** — 返信したら元メールを自動でアーカイブ（受信箱を片付ける）
- **個人情報マスキング（既定ON）** — AIに送る前に、本文中のメールアドレス・電話番号・クレジットカード番号（Luhn検証）・12桁番号・郵便番号を**端末内で可逆トークンに置換**し、AIの出力で原文に復元。LLMプロバイダに構造化PIIが渡りません（人名等の非構造PIIはPhase 2でNER対応予定）。設定でOFF可
- **AI重要度判定 + 学習** — 一覧は無料の簡易判定（学習シグナル＋キーワード）でチップ表示、開くとAIが理由付きで精密判定。`重要/通常/低` のフィードバックがその送信者・ドメインのシグナルとして蓄積され、次回以降の判定に反映（per-userナレッジの種）
- **仕分けレビュー** — すべてのAI判定と理由を一覧し、`重要/通常/低` で**是正**できる画面。是正は即座に学習へ反映され、教師データとしても蓄積（一致率も表示）
- **スター（お気に入り）** — Gmail `STARRED` / IMAP `\Flagged` を直接読み書きするので**他のメーラーと相互に同期**。フォルダ横断の「スター付き」ビュー
- **検索** — 件名・本文・差出人をローカルキャッシュ横断で検索（全アカウント・全フォルダ）
- **HTMLメール表示** — サニタイズ＋サンドボックスで安全にレンダリング。リモート画像は既定でブロック
- **受信箱の表示開始日** — 「○月○日より前は受信箱に出さない」を設定可能（接続設定内）。数万通の過去メールがある受信箱でも、それ以前を遡らずに**受信箱ゼロ**へ到達できます。サーバ上のメールには一切手を付けません
- **複数アカウント** — Gmail＋会社メール（IMAP）を同時接続。**統合受信箱**とアカウント別表示を切替（行にアカウントバッジ）。返信は元メールのアカウントから送信
- **ローカルSQLiteキャッシュ** — 取得したメールを `node:sqlite` にキャッシュ（テキストのみ・添付なし）。プロバイダ障害時はキャッシュから表示。**各アカウント直近5,000通で自動間引き**
- **容量メーター** — サイドバーにキャッシュ使用量（MB・通数）を常時表示。ホバーでアカウント別内訳
- **連絡先（自動生成）** — やりとりから**手入力ゼロ**でアドレス帳を構築（送信箱・アーカイブも自動取得して取りこぼしを防止）。名前・アドレスで検索でき、自分のアドレスも「自分」バッジ付きで表示（セルフメール＝メモのタイムライン）。人物ページで全履歴をチャット形式で振り返り（ミニCRMの種）
- **キーボード操作** — `j`/`k` 移動、`e` アーカイブ（会話単位）、`s` スター、`r` AI返信、`Shift+R` 普通の返信、`a` 全員に返信、`f` 転送、`c` 新規作成、`#`/`Backspace` ゴミ箱（会話単位）

> 仕様の詳細（なぜこの方式か・制約）は [`docs/`](docs/) の各設計書（特に [04 §1.5/§1.6](docs/04-threads-and-organization.md)・[02 §8.1](docs/02-importance-triage-learning.md)）に記録しています。

## アーキテクチャ（差し替え可能な抽象化）

| 層 | 抽象化 | 実装 |
|----|--------|------|
| AI | `src/lib/ai/model.ts` | Claude（Anthropic）/ OpenAI / OpenRouter / Vercel AI Gateway を切替。**アプリ内 設定画面（BYOK）** または env で指定（設定がenvに優先）。将来ローカルLLMも追加可 |
| Email | `src/lib/email/provider.ts` | Gmail API / 汎用IMAP+SMTP / モック（資格情報なしで動く）を自動判定 |
| 永続化 | `src/lib/store.ts` + `src/lib/db.ts` | 設定はローカルJSON、メールキャッシュは**ローカルSQLite**（`node:sqlite`・`.data/asanagi.db`）。どちらも端末外に出ない |

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
- [05 — カレンダー連携（招待メール→会議カード→Googleカレンダー登録）](docs/05-calendar-bridge.md)

## ロードマップ

- **Phase 1** — Gmail API・AI返信＋添削・重要度判定＋学習・送信/予約・アーカイブ/ゴミ箱（Web）
- **Phase 2** — IMAP/SMTP（会社メール）、**Macネイティブ（Tauri想定）**、**スレッド表示**、**インボックス整理（バンドル/送信者レーン/スマートビュー）**、PIIマスキング（構造化PIIは対応済み・人名等のNERが残り）、ローカルLLM/ローカル学習、新着のみ同期
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
