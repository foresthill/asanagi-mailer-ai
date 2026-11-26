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

/** HTML中の「引用（過去のやりとり）ブロック」開始位置のマーカー。 */
const HTML_QUOTE_MARKERS = [
  /<blockquote[^>]*type=["']?cite/i, // Gmail / Apple Mail
  /<div[^>]*class=["'][^"']*gmail_quote/i, // Gmail
  /<div[^>]*class=["'][^"']*moz-cite-prefix/i, // Thunderbird
  /<div[^>]*id=["']?(?:divRplyFwdMsg|appendonsend)/i, // Outlook
];

/** プレーンテキストで「ここから下は引用」と判断する行パターン。 */
const PLAIN_QUOTE_MARKERS = [
  /^>/, // quoted line
  /^On\b.+\bwrote:\s*$/i, // "On ... wrote:"
  /^-{2,}\s*Original Message\s*-{2,}/i, // Outlook delimiter
  /^_{5,}\s*$/, // Outlook underline divider
  /^\d{4}年\d{1,2}月\d{1,2}日.*(?:wrote|書きました)/, // 日本語の引用ヘッダ
  /^.{0,80}<[^>\s@]+@[^>\s]+>\s*$/, // "Name <addr@host>" だけの行（引用ヘッダ末尾）
];

/**
 * メール本文を「本文（最新の発言）」と「引用（過去のやりとり）」に分ける。
 * 翻訳の既定は本文のみ・引用は別ボタンで、という方針のため（遅いAIで全文を
 * 毎回訳さない）。完全な分離は不可能だが、閲覧補助として実用的に切る。
 * HTMLは引用ラッパ（blockquote cite / gmail_quote 等）で、プレーンは行頭パターンで判定。
 * 戻り値はどちらも cleanForAI 済み。quote が無ければ quote="".
 */
export function splitQuoted(raw: string): { main: string; quote: string } {
  if (!raw) return { main: "", quote: "" };
  // 1) HTMLの引用ラッパがあれば、生HTMLの最初のマーカー位置で割ってから整形。
  let cut = -1;
  for (const re of HTML_QUOTE_MARKERS) {
    const m = raw.search(re);
    if (m > 0 && (cut === -1 || m < cut)) cut = m;
  }
  if (cut > 0) {
    return {
      main: cleanForAI(raw.slice(0, cut)),
      quote: cleanForAI(raw.slice(cut)),
    };
  }
  // 2) プレーン: 整形してから行頭パターンで引用境界を探す（先頭行は対象外）。
  const clean = cleanForAI(raw);
  const lines = clean.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    if (PLAIN_QUOTE_MARKERS.some((re) => re.test(ln))) {
      return {
        main: lines.slice(0, i).join("\n").trim(),
        quote: lines.slice(i).join("\n").trim(),
      };
    }
  }
  return { main: clean, quote: "" };
}
