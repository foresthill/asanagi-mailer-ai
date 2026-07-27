import path from "node:path";

/**
 * Local Japanese NER (人名 PER / 社名 ORG) — fully on-device, no external API
 * (local-first). Loaded LAZILY and via DYNAMIC import so the heavy ML runtime
 * (onnxruntime) never touches app startup nor users who leave NER masking off.
 *
 * It's a token-classification (encoder) model, NOT generative: one forward pass
 * (~50ms/mail) and it never rewrites text — it only tags spans, which the PII
 * masker turns into reversible tokens. cameltech's generative model was 15–65s
 * and mangled the body; see docs/06-pii-masking.md and scripts/pii-ner-poc/.
 *
 * Caveat (measured): multilingual mBERT mis-segments some Japanese spans at low
 * confidence (e.g. 佐々木 → 佐/々/木). We keep only high-confidence spans so a
 * bad span is dropped rather than corrupting text — structured PII (mail/phone)
 * is caught by regex regardless. A JP-specialized model is the accuracy upgrade.
 */

const MODEL = "Xenova/bert-base-multilingual-cased-ner-hrl";
const MIN_SCORE = 0.9; // below this mBERT emits mangled JP fragments
const MIN_LEN = 2; // 1-char spans are noise

export interface NerEntity {
  text: string;
  type: "PER" | "ORG";
}

type Tok = { entity?: string; word?: string; score: number };
type Span = { text: string; type: string; score: number };
/** Minimal shape we use — the full pipeline type's union is too complex for TS. */
type NerPipe = (text: string) => Promise<Tok[]>;

let pipePromise: Promise<NerPipe> | null = null;

async function getPipe(): Promise<NerPipe> {
  if (!pipePromise) {
    pipePromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Weights live inside the project (.data is gitignored) — never re-fetched
      // once cached, and never leave the device.
      env.allowLocalModels = false;
      env.cacheDir = path.join(process.cwd(), ".data", "hf-cache");
      const pipe = await pipeline("token-classification", MODEL);
      return pipe as unknown as NerPipe;
    })();
  }
  return pipePromise;
}

/** Merge B-/I- token runs (incl. ## subword joins) into whole spans. */
function merge(tokens: Tok[]): Span[] {
  const spans: Span[] = [];
  let cur: Span | null = null;
  for (const t of tokens) {
    const tag = t.entity ?? "O";
    if (tag === "O") {
      cur = null;
      continue;
    }
    const type = tag.replace(/^[BI]-/, "");
    const word = String(t.word ?? "").replace(/^##/, "");
    if (tag.startsWith("B-") || cur === null || cur.type !== type) {
      cur = { text: word, type, score: t.score };
      spans.push(cur);
    } else {
      cur.text += word;
      cur.score = Math.min(cur.score, t.score);
    }
  }
  return spans;
}

/**
 * Detect person/company names in `text`. High-confidence only (score ≥ 0.9,
 * len ≥ 2): we'd rather MISS a name than corrupt text with a bad span
 * (over-masking is the safe direction). Returns distinct surface strings.
 */
export async function detectEntities(text: string): Promise<NerEntity[]> {
  if (!text?.trim()) return [];
  const pipe = await getPipe();
  const raw = await pipe(text);
  const out: NerEntity[] = [];
  const seen = new Set<string>();
  for (const s of merge(raw)) {
    if ((s.type !== "PER" && s.type !== "ORG") || s.score < MIN_SCORE) continue;
    const t = s.text.trim();
    if (t.length < MIN_LEN || seen.has(t)) continue;
    seen.add(t);
    out.push({ text: t, type: s.type });
  }
  return out;
}
