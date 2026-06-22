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
