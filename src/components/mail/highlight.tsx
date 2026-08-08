import { Fragment, type ReactNode } from "react";

/** Common function words not worth highlighting on their own (mirrors
 *  db.searchCached's fallback so we don't light up every "the"/"on"). */
const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "on", "at", "by", "for", "and", "or", "is",
  "are", "be", "with", "from", "this", "that", "it", "as", "was", "were", "will",
  "your", "you", "please", "we", "our",
]);

/**
 * Terms to highlight, aligned with db.searchCached: for a multi-word query,
 * highlight the whole phrase first (the precise match), then the meaningful
 * words — dropping 1-char and stopwords so "the"/"on" don't get highlighted.
 */
export function parseTerms(query?: string): string[] {
  const q = (query ?? "").trim();
  if (!q) return [];
  const words = q.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const meaningful = words
    .filter((t) => t.length >= 2 && !STOP.has(t.toLowerCase()))
    .slice(0, 6);
  // Phrase first (longest → wins in the alternation); fall back to raw words
  // only when everything was filtered out (e.g. a query of just "the").
  if (words.length > 1) return [q, ...meaningful];
  return meaningful.length ? meaningful : words;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Wrap search-term matches in <mark> (highlighter look, dark-mode aware).
 * Case-insensitive; regex specials in terms are escaped. No terms / no match →
 * the text is returned unchanged.
 */
export function markTerms(text: string, terms: string[]): ReactNode {
  if (!terms.length || !text) return text;
  // One capture group around the alternation → split() alternates text / match.
  const parts = text.split(new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi"));
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-amber-200/80 px-0.5 text-fg dark:bg-amber-400/30">
        {p}
      </mark>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}
