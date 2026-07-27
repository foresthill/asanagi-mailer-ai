# Asanagi（朝凪）設計書 — PIIマスキングとローカルNER

最終更新: 2026-07-09

外部のAI（BYOKのLLM）へメール本文を渡す際に、個人情報（PII）を可逆トークンに置換してから送る「関所」の設計と、その精度を測る観測ログ、そして人名・住所まで隠すためのローカルNER導入の調査メモ。位置づけは [00](00-overview.md) の Phase 2「PIIマスキング・ローカルLLM/ローカル学習」。

## 1. なぜマスクするのか（大前提）

- **LLM は外部API**。BYOKプロバイダ（OpenRouter/Anthropic 等）へ本文を送る＝端末外にデータが出る、唯一の例外。だから送信前に構造化PIIをトークン化する（`lib/ai/pii.ts` が全AIルートの関所）。
- **NER（固有表現抽出）は逆に「端末内で完結させる前処理」**。人名などを隠すためにモデルを使うが、それは**ローカル実行**であって外部APIではない（後述）。「AIをAPIで使う」わけではない点に注意。
- 方針: local-first。可逆トークンなので、AIの出力は端末側で原文に復元でき、返信品質を落とさない。誤検出は「余計に隠す」安全側に倒す。

## 2. 現状の仕組み（正規表現ベース）

`lib/ai/pii.ts` の `PiiMasker`:

- 検出＝正規表現。対象は**構造化PII**: メールアドレス・電話番号・カード番号(Luhn)・12桁数字(マイナンバー等)・郵便番号。
- `maskEmail()` は From/To/Cc/Bcc の**アドレスもマスク**（ドメイン＝会社特定につながるため丸ごと。表示名は宛名品質のため残す）。学習シグナル（送信者アドレス/ドメイン）もマスク。
- 可逆トークン（`[EMAIL_1]` 等）＋ `unmask()` で出力を原文へ復元。同じ値は常に同じトークン（本文と From が整合）。

### 対象外（現状の穴）

**人名・住所などの非構造PIIは正規表現では取れない**。ここを隠すには NER が必要（本書 §4）。

## 3. マスキング観測ログ（実装済み）

精度を「測れる」ようにする仕組み。AIログ（`ai_usage.mask_audit`）に呼び出しごとの監査を記録:

- **統計**: 種類別マスク数 `{ EMAIL:5, PHONE:2, DOMAIN:3 }`。
- **漏れ自己監査（residual）**: 送信直前の最終テキストを再スキャンし、**マスクを素通りした構造化PII**の件数を数える。トークンは検出されないので、ヒット＝未マスク経路（ユーザー自筆の指示/メモ、ヘッダ等）からの本物の漏れ。`residual>0` なら `console.warn`（握りつぶさない）＋ AIログUIに ⚠ 表示。
- **限界の明示**: residual は構造化PIIのみ。人名・住所は未検出（＝residual 0 は「構造化PIIは漏れていない」であって「完全匿名化」ではない）。

実装: `PiiMasker.stats()/residualPii()/audit()`、`auditOutgoing()`、`AiLogView` 表示。

## 4. ローカルNER導入の調査（人名・住所を隠す）

将来 MCP / A2A（[標準の整理](#6-参考) 参照）で端末外にデータを出す場面が増えるほど、マスク精度が鍵になる。人名・住所を隠すには NER が必要。候補を調査した。

### 4.1 大原則: NER は「ローカル実行」で選ぶ

外部API型のNER（クラウドに本文を送る）は local-first に反するので不可。**端末内で動く**ものだけを候補にする。

### 4.2 候補比較

| 方式 | 精度（日本語） | ランタイム | Asanagi との相性 |
|---|---|---|---|
| **GiNZA**（spaCy系・Megagon Labs） | ◎ 定番。人名・地名/住所・組織を抽出 | **Python** ＋ spaCy ＋ 学習モデル（数十MB〜） | △ Python同梱が重い。Tauri（Nodeサイドカー）に**もう一つPythonサイドカー**を足す形になり配布サイズ・梱包コスト増 |
| **transformers.js ＋ 日本語NER/PIIモデル(ONNX)** | ○ モデル次第 | **Node/WASM でプロセス内実行**（ONNX Runtime）。外部APIではない | ◎ Python不要でNodeに閉じる。local-first / Tauri と相性良い（※実在モデル・精度・サイズは**要検証**） |
| 現状（正規表現のみ） | 構造化のみ・人名不可 | 依存ゼロ | ◎ 追加依存なし（現状維持） |

### 4.3 見立てと推奨（一部推測を含む）

- 品質だけなら **GiNZA が確実**（日本語NERの定番）。ただし **Python依存が local-first / Tauriデスクトップ方針と噛み合いにくい**。
- Node/local-first の制約では、**transformers.js で日本語PII/NERモデルを端末内実行**する方が筋が良い可能性が高い（Python不要・端末から出さない前処理）。`pii.ts` のコメントにある「Phase B: ローカルNER」の想定とも一致。
- どちらを採るにせよ、**§3 の残留監査ログが、NER導入後は人名の検知にも拡張できる土台**になる。

### 4.4 次アクション（未検証。着手前に調べる）

1. transformers.js で動く日本語 NER/PII モデル（ONNX）の**実在・精度・モデルサイズ・推論速度**を検証。
2. 実用的なものが無ければ、**GiNZA を Python サイドカー**で（Tauri のサイドカー方式に相乗り）。
3. 導入後、`residualPii` を NER 結果でも評価できるよう拡張。

### 4.5 PoC #2 実測結果（2026-07-27・transformers.js token-classification）

`scripts/pii-ner-poc/poc.mjs` で `Xenova/bert-base-multilingual-cased-ner-hrl`（多言語BERT・PER/ORG/LOC/DATE、ONNX・transformers.js対応）を Node で実行し、合成メールで実測（**顧客の実メールは不使用**）。

- **レイテンシ: 平均49ms/通**（34〜60ms）。cameltech（生成型LLM）の15〜65秒から桁違いに速い。**要因はトークン分類型（エンコーダ）＝1回の順伝播・本文を書き換えない**こと。生成型を選んだのがcameltech失敗の一因。
- **人名(PER)/社名(ORG)は高精度に捕捉**（合成サンプル）: 佐藤健一 1.00 / 山田花子 0.93 / 株式会社ヤマト 0.94 / 株式会社みらい商会 1.00 等。
- **課題**: 多言語mBERTは日本語の単語境界が甘く、低信頼度で分割ミス（例「佐々木」→ 佐/々/木、スコア0.53〜0.68）。「〜商事」の欠落など。
- **初回モデルロード: 738秒（fp32・約680MB DL）**。以降はキャッシュから数秒。メモリ常駐は数百MB。

**採用（Phase B-lite・#154）**: `src/lib/ai/ner.ts` として実装。**信頼度 ≥ 0.9・長さ ≥ 2 の PER/ORG のみ**採用し、壊れた低スコア断片は捨てる（＝取りこぼしても本文を壊さない安全側）。既存の正規表現マスカー（構造化PII）に合流し、`[NAME_n]`・`[ORG_n]` の**可逆トークン**にする。**既定OFFのオプトイン**＋**動的import**（有効時のみ onnxruntime を読込）で、ネイティブ依存を平時のパスから隔離。

**実機検証（dev:3100・合成データ）**: 返信生成で、本文・差出人/宛先名・視点ガードに含まれる人名・社名が送信プロンプトで全てトークン化（`[NAME_n]`/`[ORG_n]`）され `residual:0`、出力は原文復元で正しい宛名・署名になることを確認。

**残課題（次段階＝A）**: 日本語特化モデル（XLM-RoBERTa-ja NER 等）を ONNX 化して境界精度を上げる。q8量子化でロード時間・メモリを削減。`residualPii` は構造化PIIのみ評価で、NER取りこぼしは検知できない点は不変。

## 5. 判断メモ

- 「AIをAPIで使う」＝LLM（返信生成・重要度判定等）の部分。**NERはローカル**なので混同しない。
- transformers.js が有力なのは「Python不要でNodeに閉じる」から。ただし**日本語NERの実モデルが要件（精度/サイズ）を満たすかは未確認**なので、断定はしない。

## 6. 参考

- GiNZA（公式）: https://megagonlabs.github.io/ginza/
- GiNZAによるPII抽出の例（AI Shift）: https://www.ai-shift.co.jp/techblog/557
- Transformers.js（Hugging Face・ブラウザ/Nodeでモデルをローカル実行）: https://huggingface.co/docs/transformers.js
- MCP（Model Context Protocol）: https://en.wikipedia.org/wiki/Model_Context_Protocol
- A2A（Agent2Agent, Linux Foundation）: https://a2a-protocol.org/latest/
