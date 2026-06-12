/**
 * Best-effort repair for legacy "double mojibake" text: UTF-8 bytes that were
 * misread as Windows-1252/Latin-1 (sometimes twice) by an old sender, e.g.
 *   "こんにちは" → "Ã£ÂÂ“…" → displayed as "Ã£Â Â“…"
 * Some byte values (0x81, 0x8D, 0x8F, 0x90, 0x9D — undefined in cp1252) get
 * replaced by spaces along the way, so we reconstruct them when they sit in
 * a position where UTF-8 requires a continuation byte (0x81 is by far the
 * most common in Japanese text).
 *
 * Conservative by design: the repaired text is used only if the full decode
 * is valid UTF-8 (no replacement chars) AND contains CJK — otherwise the
 * original string is returned unchanged.
 */

// Windows-1252 0x80–0x9F range, reversed (char → original byte).
const CP1252_REVERSE: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84,
  "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88,
  "‰": 0x89, "Š": 0x8A, "‹": 0x8B, "Œ": 0x8C,
  "Ž": 0x8E, "‘": 0x91, "’": 0x92, "“": 0x93,
  "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9A, "›": 0x9B,
  "œ": 0x9C, "ž": 0x9E, "Ÿ": 0x9F,
};

/** Spaces standing in for bytes lost in cp1252 round-trips become 0x81. */
const LOST_BYTE = 0x81;

function isContinuation(b: number): boolean {
  return b >= 0x80 && b <= 0xbf;
}

/** One level of un-scrambling; null when the string isn't this kind of mess. */
function unscramble(s: string): string | null {
  // Char → byte (inverse of "bytes read as cp1252/latin1").
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xff) bytes.push(cp);
    else if (CP1252_REVERSE[ch] !== undefined) bytes.push(CP1252_REVERSE[ch]);
    else return null; // genuine non-Latin char → not mojibake
  }

  // Walk as UTF-8, restoring lost continuation bytes that became spaces.
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let need = 0;
    if (b < 0x80) {
      out.push(b);
      i++;
      continue;
    } else if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) need = 2;
    else if (b >= 0xf0 && b <= 0xf4) need = 3;
    else return null; // stray continuation byte where a lead is expected

    out.push(b);
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c !== undefined && isContinuation(c)) out.push(c);
      else if (c === 0x20) out.push(LOST_BYTE); // space standing in for a lost byte
      else return null;
    }
    i += need + 1;
  }

  const decoded = Buffer.from(out).toString("utf8");
  return decoded.includes("�") ? null : decoded;
}

const MOJIBAKE_GATE = /[À-ÿ]/; // needs Latin-1 supplement chars to even be a candidate
const CJK = /[　-ヿ㐀-鿿＀-￯]/;

// ---------------------------------------------------------------------------
// HTML entities — plain-text bodies derived from HTML mail (and Gmail API
// snippets, which arrive HTML-escaped) must not show &gt; / &quot; literally.
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  copy: "©",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/** Decode numeric (&#12345; / &#x3042;) and common named HTML entities. */
export function decodeEntities(s: string): string {
  if (!s || !s.includes("&")) return s;
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const cp = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Repair double-mojibake text; returns the input unchanged when not applicable. */
export function repairMojibake(s: string): string {
  if (!s || !MOJIBAKE_GATE.test(s)) return s;
  let cur = s;
  for (let depth = 0; depth < 3; depth++) {
    const next = unscramble(cur);
    if (next === null) break;
    cur = next;
    if (!MOJIBAKE_GATE.test(cur)) break;
  }
  // Only accept when we actually surfaced CJK text; otherwise leave it alone.
  return cur !== s && CJK.test(cur) ? cur : s;
}
