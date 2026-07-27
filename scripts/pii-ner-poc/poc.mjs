/**
 * PoC #2: token-classification NER via transformers.js (@huggingface/transformers).
 * 人名(PER)・社名(ORG)・地名(LOC) をローカルで検出し、朝凪のPIIマスカーに
 * 足せるか（精度・レイテンシ・本文非改変）を測る。
 *
 * cameltech(生成型LLM)との違い: これはエンコーダのトークン分類なので
 *   1) 本文を書き換えない（スパンにタグを付けるだけ→マスクは端末側で置換）
 *   2) 1回の順伝播で速い（自己回帰生成なし）
 *
 * 実行: cd scripts/pii-ner-poc && npm install && node poc.mjs
 * 注意: 顧客の実メールは使わない（合成サンプルのみ — テスト安全規則）。
 */
import { pipeline, env } from "@huggingface/transformers";

// HFハブからDL（初回のみ）。ローカルモデル探索は無効化。
env.allowLocalModels = false;

const MODEL = "Xenova/bert-base-multilingual-cased-ner-hrl";

// 合成メールサンプル（実在しない人名・社名・住所・電話）
const SAMPLES = [
  `田中様

お世話になっております。株式会社ヤマト商事の佐藤健一です。
先日の打ち合わせの件、弊社の鈴木が担当いたします。
資料は東京都港区六本木1-2-3 ヤマトビル5Fへお送りください。

よろしくお願いいたします。`,
  `山田花子様

ご注文ありがとうございます。株式会社みらい商会です。
お届け先: 大阪府大阪市北区梅田4-5-6 グランドハイツ302号室
お問い合わせは佐々木まで（090-1234-5678）。`,
  `各位

来週の定例会議は6月22日17時からです。
議事録は前回どおり高橋さんが作成します。
場所は株式会社ネクスト本社3階会議室Aです。`,
];

/** B-/I- タグの連続トークンを1スパンに束ねる（subword結合込み）。 */
function mergeEntities(tokens) {
  const spans = [];
  let cur = null;
  for (const t of tokens) {
    const tag = t.entity ?? t.entity_group ?? "O";
    const type = tag.replace(/^[BI]-/, "");
    const isB = tag.startsWith("B-") || cur?.type !== type;
    const word = (t.word ?? "").replace(/^##/, "");
    if (tag === "O") {
      cur = null;
      continue;
    }
    if (isB || !cur) {
      cur = { type, text: word, score: t.score };
      spans.push(cur);
    } else {
      cur.text += word;
      cur.score = Math.min(cur.score, t.score);
    }
  }
  return spans;
}

async function main() {
  const t0 = Date.now();
  const ner = await pipeline("token-classification", MODEL);
  console.log(`model: ${MODEL}`);
  console.log(`load: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const latencies = [];
  for (let i = 0; i < SAMPLES.length; i++) {
    const text = SAMPLES[i];
    const t1 = Date.now();
    const out = await ner(text);
    const dt = Date.now() - t1;
    latencies.push(dt);
    const spans = mergeEntities(out);
    console.log(`===== sample ${i + 1} (${dt}ms, ${text.length} chars) =====`);
    for (const s of spans) {
      console.log(`  ${s.type.padEnd(4)} "${s.text}"  (${s.score.toFixed(2)})`);
    }
    if (!spans.length) console.log("  (検出なし)");
    console.log();
  }
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`--- 平均レイテンシ: ${avg.toFixed(0)}ms/通 (${SAMPLES.length}通) ---`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
