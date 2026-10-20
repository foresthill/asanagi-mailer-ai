/**
 * AIに渡す本文のクリーン化。HTMLメールのテキスト抽出が甘く、Outlook向けの
 * 条件コメント `<!--[if !mso]>…<![endif]-->` の中身や残タグが混ざると、翻訳・
 * 要約の品質が落ちる（訳文に `<!--[if !mso]>` 等が出る）。AIに送る直前にここで
 * 落とす。素のプレーンテキスト（タグ無し）はほぼ素通り。
 */

/** Minimal HTML entity decode (names + numeric). */
function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    mdash: "—",
    ndash: "–",
    hellip: "…",
    copy: "©",
    reg: "®",
    trade: "™",
  };
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[body.toLowerCase()] ?? m;
  });
}

/**
 * Collapse any HTML-ish remnants into readable plain text. Safe on text that is
 * already plain (no tags → returned essentially unchanged, just whitespace-normalized).
 */
export function cleanForAI(input: string): string {
  if (!input) return "";
  let s = input;
  // 1) Comments FIRST (incl. mso conditionals) — content inside must not leak.
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // 2) style/script blocks (CSS/JS text would otherwise leak).
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  // 3) Block boundaries → newlines so structure survives.
  s = s.replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\s*\/?>/gi, "\n");
  // 4) Remaining tags.
  s = s.replace(/<[^>]+>/g, "");
  // 5) Entities, then whitespace tidy.
  s = decodeEntities(s)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t　]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}
