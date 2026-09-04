# Asanagi MCP サーバ（読み取り専用・ローカル）

Asanagi のローカルキャッシュ（`.data/asanagi.db`）と プロジェクト・ハブ
（`.data/projects.json`）を **MCP ツール**として公開します。Claude 側から
「このメール来てた？」「あの件どうなってた？」「プロジェクトの進捗は？」を
**端末内のデータ**で答えられます。

- **read-only**（検索・取得・進捗のみ）。送信/アーカイブ/削除はアプリ側の明示操作に限定。
- **local-first**：ローカルの SQLite を読むだけ。答えは接続した AI クライアントに渡ります（＝BYOK と同じ扱い）。
- 検索対象は **同期済みキャッシュ**。まだ触れていない古いメールは、先にアプリで開く/同期すると対象になります。

## 公開ツール
| tool | 用途 |
|---|---|
| `search_mail(query, limit?)` | メール検索（件名・本文・差出人・宛先） |
| `list_recent(folder?, account?, limit?)` | フォルダの最近のメール |
| `get_thread(id)` | 会話を時系列で（自分の送信も含む） |
| `check_received(from?, subject?, sinceDays?)` | 届いているか確認（件数＋最新） |
| `get_email(id)` | 1通の本文全文 |
| `list_projects()` | プロジェクト・ハブ（進捗・次アクション） |

## セットアップ

前提：一度アプリを起動してメールを同期し、`.data/asanagi.db` がある状態。

### Claude Code
```bash
claude mcp add asanagi -- node /Users/foresthill/Development/AI-Driven/ai-mailer/mcp/asanagi-mcp.mjs
```
（`claude mcp list` で確認 / `claude mcp remove asanagi` で削除）

### Claude Desktop
`~/Library/Application Support/Claude/claude_desktop_config.json` に追記：
```json
{
  "mcpServers": {
    "asanagi": {
      "command": "node",
      "args": ["/Users/foresthill/Development/AI-Driven/ai-mailer/mcp/asanagi-mcp.mjs"]
    }
  }
}
```
保存して Claude Desktop を再起動。

### データ場所を変える場合
`.data` 以外を使うときは `ASANAGI_DATA_DIR` を env で渡す：
```json
"env": { "ASANAGI_DATA_DIR": "/path/to/.data" }
```

## Claude Desktop にワンクリック導入（.mcpb・推奨）

設定JSONを手で書かず、**Desktop Extension（`.mcpb`）**でクリック導入できます。

### ビルド
```bash
cd mcp
npm install
npx --yes @anthropic-ai/mcpb pack . asanagi.mcpb
```
→ `mcp/asanagi.mcpb` が生成（サーバ＋依存＋manifest を同梱。**メール本体 .data は含まない**）。

### インストール
1. Claude Desktop → **Settings → Extensions → Install Extension**
2. `asanagi.mcpb` を選択
3. **「Asanagi データフォルダ」**に、このリポジトリの `.data`（`asanagi.db` がある場所）を指定
4. 確認 → 完了（`asanagi` の6ツールが使える）

### 配布（GitHub Actions）
`.github/workflows/mcpb.yml` がタグ `mcp-v*`（または手動実行）で `.mcpb` をビルドし、
Release に添付します。バンドルはコードのみなので公開リリースで秘匿データは出ません。
```bash
git tag mcp-v0.1.0 && git push origin mcp-v0.1.0
```

## 動作確認
```bash
npm run mcp   # 単体起動（stdio。Ctrl+C で終了）
```
エラーなく起動すれば OK（実際の呼び出しは上記クライアントから）。

## メモ（今後）
- claude.ai（web）から使うには HTTP トランスポート版＋認証が必要（別途）。
- 書き込み系ツール（送信・アーカイブ等）は事故防止のため未実装。入れる場合は明示確認付きで。
