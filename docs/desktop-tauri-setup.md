# デスクトップ化（Tauri）セットアップ手順

Asanagi をデスクトップアプリにする手順。設計の決定は [03 §6](03-providers-sync-native.md)（Tauri 先行）。

> **重要な前提**: Asanagi は「React UIだけ」ではなく **Node サーバ必須**（node:sqlite・googleapis・imapflow・`.data/`・AIルート）。よって Tauri の WebView だけでは動かず、**Next.js standalone サーバを Node サイドカーとして同梱**する方式を採る。本書は2段階で進める。
>
> - **Stage A**: `tauri dev` でネイティブ窓に Asanagi を表示（dev サーバに接続するだけ・packaging不要）。まずここで「窓が出る」を確認する。
> - **Stage B**: 本番バンドル（standalone サーバ＋Node をサイドカー同梱し Rust から起動）。難所。

出典（一次情報）:
- 前提条件: https://v2.tauri.app/start/prerequisites
- 開発 / devUrl・beforeDevCommand: https://v2.tauri.app/develop
- CLI（init / dev / build）: https://v2.tauri.app/reference/cli
- Node.js サイドカー: https://v2.tauri.app/learn/sidecar-nodejs
- サイドカー（target triple・権限）: https://v2.tauri.app/develop/sidecar

---

## Stage A — まずネイティブ窓を出す

### A-1. 前提ツール（初回のみ・あなたの環境）

```bash
# Xcode Command Line Tools（未導入なら）
xcode-select --install

# Rust（rustup）
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
# 完了後、ターミナルを開き直すか:  source "$HOME/.cargo/env"
rustc --version   # 確認
```

### A-2. Tauri CLI を devDependencies に追加

```bash
npm install -D @tauri-apps/cli@latest
```

### A-3. Tauri を初期化（`src-tauri/` を生成）

```bash
npm run tauri init
```

プロンプトの回答（この通りに）:

| 質問 | 回答 |
|---|---|
| App name | `Asanagi` |
| Window title | `Asanagi` |
| Web assets location（frontendDist） | `../public`（暫定。Stage Bで見直す） |
| dev server URL（devUrl） | `http://localhost:3100` |
| before dev command | **空のままEnter**（dev サーバは自分で起動するため） |
| before build command | **空のままEnter** |

> `beforeDevCommand` を空にするのが肝。Tauri に dev サーバを起動させず、すでに動いている `PORT=3100 npm run dev` に **接続するだけ**にする。

### A-4. 起動して窓を確認

ターミナル1（いつも通り dev サーバ）:
```bash
PORT=3100 npm run dev
```
ターミナル2（Tauri 窓）:
```bash
npm run tauri dev
```
→ ネイティブウィンドウに Asanagi が表示されれば Stage A 成功。初回は Rust 依存のコンパイルで数分かかる。

### A-5. 生成後の微調整（任意・`src-tauri/tauri.conf.json`）
- `build.devUrl` = `http://localhost:3100`（A-3で設定済みのはず）
- `build.beforeDevCommand` = `""`
- `app.windows[0]` の `title` / `width` / `height` を調整

---

## Stage B — 本番バンドル（Node サイドカー）※次の山場

方針: `BUILD_STANDALONE=1 npm run build:standalone` で `.next-standalone/standalone/server.js` を作り、これを **Node ランタイムごと**サイドカー同梱して Rust 起動時に spawn、WebView を `http://localhost:<port>` に向ける。

未確定の課題（着手時に詰める）:
- **Node の同梱方法**: `node` バイナリを `externalBin` として target triple 付きで同梱（`sidecar-<triple>`）／または SEA 等で単一バイナリ化。node:sqlite は Node 22+ ビルトインのため単純な pkg 化は不可。`node` 同梱が現実的。
- **server.js と node_modules の同梱**: `.next-standalone/standalone` を Tauri の `resources` に含める。
- **`.data` の保存先**: `ASANAGI_DATA_DIR` を OS アプリデータ領域（例 `~/Library/Application Support/Asanagi`）に設定して spawn（コードは対応済み: store.ts / db.ts）。
- **ポート**: 空きポートを動的に選んで server に渡し、WebView もそのポートへ。
- **OAuth リダイレクト**: Gmail 認証のコールバックURL（現在 localhost 前提）の扱い。
- **権限**: `shell:allow-execute`（sidecar: true）を capabilities に付与。

これらは Stage A が通ってから、1つずつ実機検証して進める。

---

## Stage C — コード署名＋公証（macOS 配布）

配布した `.app`/`.dmg` を他の Mac で Gatekeeper 警告なしに開けるようにする。
**Developer ID Application 証明書での署名時は公証（notarization）が必須**。

出典（一次情報）:
- Tauri v2 macOS 署名: https://v2.tauri.app/distribute/sign/macos/
- Hardened Runtime: https://developer.apple.com/documentation/security/hardened_runtime
- notarytool: https://developer.apple.com/documentation/security/customizing-the-notarization-workflow

### C-1. 前提（あなたの環境）

- Apple Developer Program 加入済み、`Developer ID Application: …` 証明書が keychain にある
  （確認: `security find-identity -v -p codesigning`）。
- Xcode 同梱の `notarytool` が使える（`xcrun --find notarytool`）。
- 公証用の **App 用パスワード**（通常のApple IDパスワードではない）を
  https://appleid.apple.com → サインインとセキュリティ → App用パスワード で発行しておく。

### C-2. このリポジトリで入れてある設定

- `src-tauri/tauri.conf.json` → `bundle.macOS.signingIdentity` に Developer ID を設定済み。
  `hardenedRuntime` は Tauri 既定で true（公証の必須要件）。
  ※ 別マシン/CI では環境変数 `APPLE_SIGNING_IDENTITY` で上書きできる。
- **同梱 node の再署名**: 公式 node は `Developer ID Application: Node.js Foundation` 署名だが
  `com.apple.security.get-task-allow=true`（デバッグ用 entitlement）が付いており、これは
  **公証で弾かれる**。そこで `beforeBuildCommand` で `scripts/sign-mac-sidecar.sh` を実行し、
  `src-tauri/entitlements-node.plist`（JIT/メモリ/library-validation は残し get-task-allow だけ除外）で
  **自分の Developer ID に再署名**する。macOS 以外・証明書が無い環境では自動スキップ（従来のアドホックビルドは壊れない）。

### C-3. 署名＋公証ビルドの流し方

> dev サーバ（:3100）を**止めてから**。`tauri build` は `next build` を走らせるため稼働中 dev と競合する。

```bash
# 公証用の資格情報（App用パスワードは自分のシェルで export。リポジトリに書かない）
export APPLE_ID="あなたのAppleID@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # App用パスワード
export APPLE_TEAM_ID="M836YTN2FQ"

# 署名＋公証つきビルド
npm run tauri build
```

- 署名は keychain の証明書で自動的に行われる（`APPLE_CERTIFICATE`/`_PASSWORD` はCIで .p12 を使う時だけ）。
- 公証は上記3変数があると `tauri build` が自動で `notarytool submit` → stapling まで行う。
- App Store Connect API キー方式を使う場合は `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_PATH`。

### C-4. 検証（実機・配布前に必ず）

```bash
APP=src-tauri/target/release/bundle/macos/Asanagi.app
codesign --verify --deep --strict --verbose=2 "$APP"   # 署名の整合
spctl -a -vvv -t exec "$APP"                            # Gatekeeper 評価（accepted + Notarized になるか）
xcrun stapler validate "$APP"                           # 公証チケットが貼られているか
# 同梱 node に get-task-allow が残っていないこと
codesign -d --entitlements - --xml "$APP/Contents/Resources/.../node" 2>/dev/null | grep get-task-allow && echo "NG" || echo "OK"
```

**未検証の残課題（初回の実公証で確認する）**:
- Tauri がバンドル時に同梱 node を**再署名し直す**かどうか。もし Tauri が app 側の entitlements で
  node を上書きすると node の JIT 等が壊れうる。その場合は node 用 entitlements を保つ運用（または
  `--deep` 挙動の回避）を検討する。初回公証が失敗したら **Apple の notarization ログ**
  （`xcrun notarytool log <submission-id>`）を読んで、どの実行ファイルが弾かれたかで切り分ける。
- これらは実証明書＋App用パスワードでの実ビルドが要るため、ここまでは**設定のみ**（実公証は未検証）。
