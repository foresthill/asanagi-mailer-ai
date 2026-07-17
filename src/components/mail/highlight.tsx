import { Fragment, type ReactNode } from "react";

/** Search keywords, parsed the same way db.searchCached does (space = AND). */
export function parseTerms(query?: string): string[] {
  return (query ?? "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
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
