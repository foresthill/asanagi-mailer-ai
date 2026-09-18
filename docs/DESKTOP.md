# デスクトップ配布（Tauri）＆自動アップデート — セットアップ手順

シニアエンジニア/CTO向けの実行手順。**署名鍵・配布ホスト・OS別ビルドは実マシンで行う工程**なので、本書のとおり一度通してから配布してください。

## 方式（何を作っているか）

Asanagi は Next.js/Node アプリです。デスクトップ版は **Tauri（軽量ネイティブ窓）** が起動時に、**同梱した Next standalone サーバ**を `node` で立ち上げ、`http://localhost:3100` を窓に読み込みます。

- 完全な Node 内蔵（Electron 的）はしない第一版。**マシンに Node.js 24 が必要**（`node:sqlite` 安定版。Linux 手順と同じ前提）。
- 将来 Node バイナリを sidecar 同梱すれば Node 不要インストーラにできる（第二版候補）。
- 実装済み配線: `src-tauri/src/lib.rs`（サーバ起動＋窓ナビゲート）、`npm run build:standalone`（→ `.next-standalone/standalone`）、`tauri.conf.json` の `bundle.resources`（standalone を `server/` として同梱）、`src-tauri/splash/`（起動スプラッシュ）、`tauri-plugin-updater` 配線。

## 最短で使える／配布する（優先ルート）

**A. 今すぐ使う（ビルド・署名・リリース不要）** — Linux の CTO 環境で:
```bash
git clone https://github.com/foresthill/asanagi-mailer-ai.git   # リポジトリは public
cd asanagi-mailer-ai && npm install
npm run build:standalone && PORT=3100 node .next-standalone/standalone/server.js
# → http://localhost:3100（要 Node.js 24）
```

**B. Release から AppImage を落とせるようにする** — Linux バンドルは mac から作れないため CI が最短。
`.github/workflows/desktop.yml` を用意済み。**タグを push すると ubuntu で AppImage/.deb をビルドし Release に添付**します:
```bash
git tag app-v0.1.0 && git push origin app-v0.1.0
```
（または GitHub の Actions 画面 → "Desktop build (Linux)" → Run workflow）
→ 完了後、リポジトリの Releases に AppImage が並び、CTO はそこからダウンロード。初回は署名なし・自動更新オフ（下記で有効化）。

## 前提ツール

- **Rust**（`rustup`）— `cargo` が必要。
- **Node.js 24**（`node:sqlite` 安定）。
- **Tauri CLI** — `npx tauri`（devDep `@tauri-apps/cli` 導入済）。
- OS別ビルド依存:
  - **macOS**: Xcode Command Line Tools（WKWebView はシステム）。
  - **Linux**: `webkit2gtk-4.1`, `libappindicator3`, `librsvg2`, `patchelf` 等（AppImage/deb 用）。
  - **Windows**: WebView2 ランタイム（Win11 は概ね同梱）、MSVC Build Tools。

## ビルド（ローカル）

```bash
npm install
npm run build:standalone     # .next-standalone/standalone を生成（confのbeforeBuildCommandでも自動実行）
npx tauri build              # OSに応じた .app/.dmg / .AppImage/.deb / .msi を生成
```

- 生成物: `src-tauri/target/release/bundle/...`
- 開発時の確認: 別ターミナルで `PORT=3100 npm run dev` を起動してから `npx tauri dev`。

## 実行時の挙動と注意

- 窓は起動時に**スプラッシュ**（`src-tauri/splash`）→ サーバ待機（最大 ~15s）→ `localhost:3100` へ遷移。
- ポートは **3100 固定**（`lib.rs` の `SERVER_PORT`）。将来は空きポート探索に変更推奨。
- **`.data/` の保存先を要確定**: OAuth トークン・BYOK キー・SQLite が入る。現状サーバは実行ディレクトリ基準で `.data` を作るため、アプリ資源ディレクトリが読み取り専用だと失敗しうる。**書込可能なユーザーデータ領域**（例: `~/Library/Application Support/Asanagi`, XDG data dir）を実行時に指すよう改修が必要 → **実ビルドで要検証**。
- 初回はアプリ内で Gmail 再認証と AI キー入力が必要（秘密情報はリポジトリに無い）。

## 自動アップデート（tauri-plugin-updater）

1. **署名鍵を生成**（秘密鍵は厳重保管・CI Secret へ。紛失＝以後の更新配信不可）:
   ```bash
   npx tauri signer generate -w ~/.tauri/asanagi.key
   ```
   出力された**公開鍵**を `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に貼る（現状は `REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY`）。

2. `bundle.createUpdaterArtifacts: true` 設定済 → `tauri build` が**署名済み更新アーティファクト＋ `latest.json`** を出力。ビルド時に秘密鍵を環境変数で渡す:
   ```bash
   TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/asanagi.key)" \
   TAURI_SIGNING_PRIVATE_KEY_PASSWORD="…" \
   npx tauri build
   ```

3. **配布**: `latest.json` と各OSの署名済みバンドルを配布先へ。`endpoints` は既定で GitHub Releases の
   `https://github.com/foresthill/asanagi-mailer-ai/releases/latest/download/latest.json` を指す。
   GitHub Release にアップロードするだけで配信可能（Thunderbird 的配布に合致）。

4. **アプリ側の更新確認**（JS・起動時サイレント or 手動ボタン）:
   ```ts
   import { check } from "@tauri-apps/plugin-updater";
   import { relaunch } from "@tauri-apps/plugin-process";
   const update = await check();
   if (update) { await update.downloadAndInstall(); await relaunch(); }
   ```
   devDep に `@tauri-apps/plugin-updater` / `@tauri-apps/plugin-process` を追加。UI はサイドバーに「アップデートを確認」ボタン、または起動時チェックを推奨。

## OS別の配布メモ

- **macOS**: Apple Developer 証明書で `codesign` ＋ notarization しないと Gatekeeper 警告。updater は署名済みバンドル前提。
- **Linux**: **AppImage** が単一ファイルで配りやすい（当面の本命配布形態）。deb も可。
- **Windows**: NSIS/MSI。WebView2 未導入環境向けにブートストラップ同梱オプションあり。

## 現状の検証状況（正直な区分）

- ✅ **standalone サーバ単体起動**（:3199 で HTTP 200・Next 16）… 確認済。
- ✅ **Rust 配線**（updater ＋ サーバ起動 ＋ navigate）… `cargo check` 通過（エラー0）。
- ⚙️ **実バンドル（`tauri build`）・署名・`.data` 保存先・実機の窓遷移**… **未検証**。実ビルド環境で本書の手順を1回通して確認すること。
- ❓ **Node バイナリ同梱**（Node 不要インストーラ）… 未実装（第二版候補）。

参照: リポジトリ既存の Tauri scaffold（`src-tauri/`）、`next.config.ts`（`BUILD_STANDALONE=1` → `.next-standalone`）。
