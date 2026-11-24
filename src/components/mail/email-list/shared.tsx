import { Fragment } from "react";
import type { Email } from "@/lib/types";

/**
 * EmailList とその行コンポーネント(EmailListItem)で共有する型と純粋ヘルパ。
 * 行描画を別ファイルへ切り出す際、両者が依存するものをここに集約して循環 import を
 * 避ける（見た目・挙動は不変の純リファクタ）。
 */

/** 表示する列（送信者/プレビュー/フラグ/添付/日時）。件名は常時表示。 */
export type ColumnKey = "from" | "preview" | "flag" | "attachment" | "date";
export type ColumnPrefs = Record<ColumnKey, boolean>;
/** 右端「指標の固定列」(flag/attachment/date)。 */
export type MetaColumnKey = "flag" | "attachment" | "date";

/** Search keywords, parsed the same way db.searchCached does (space = AND). */
export function searchTerms(query?: string): string[] {
  return (query ?? "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Mark the matched keywords inside a result's text (highlighter look). */
export function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>;
  // One capture group around the alternation → split() alternates text/match.
  const parts = text.split(
    new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi"),
  );
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="rounded-sm bg-amber-200/80 px-0.5 text-fg dark:bg-amber-400/30"
          >
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Preview line for a search hit: the normal snippet when the keyword is already
 * visible there, otherwise a window cut from around the FIRST body match — so a
 * "本文" hit shows *where* in the body it matched instead of just the opening
 * 140 chars (which often don't contain the keyword at all).
 */
export function previewFor(email: Email, terms: string[]): string {
  const base = email.snippet ?? "";
  if (!terms.length) return base;
  const lowBase = base.toLowerCase();
  if (terms.some((t) => lowBase.includes(t.toLowerCase()))) return base; // already visible
  const body = email.body ?? "";
  const lowBody = body.toLowerCase();
  let at = -1;
  let len = 0;
  for (const t of terms) {
    const i = lowBody.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      len = t.length;
    }
  }
  if (at < 0) return base; // hit was elsewhere (件名/差出人/宛先)
  const start = Math.max(0, at - 40);
  const end = Math.min(body.length, at + len + 60);
  const cut = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${cut}${end < body.length ? "…" : ""}`;
}

/**
 * Which field(s) the search hit — mirrors db.searchCached (each keyword may hit
 * any field; a field is "hit" when it contains any keyword). Shown as badges so
 * it's obvious WHY a result matched (件名 / 本文 / 差出人 / 宛先).
 */
export function matchedFields(email: Email, query?: string): string[] {
  const terms = searchTerms(query).map((t) => t.toLowerCase());
  if (!terms.length) return [];
  const hit = (hay: string) => {
    const h = hay.toLowerCase();
    return terms.some((t) => h.includes(t));
  };
  const people = (list?: { name?: string; email: string }[]) =>
    (list ?? []).map((a) => `${a.name ?? ""} ${a.email}`).join(" ");
  // Returns match-field KEYS (translated at render via t(`match.${k}`)).
  const out: string[] = [];
  if (hit(email.subject)) out.push("subject");
  if (hit(email.body)) out.push("body");
  if (hit(`${email.from.name ?? ""} ${email.from.email}`)) out.push("from");
  if (hit(`${people(email.to)} ${people(email.cc)}`)) out.push("to");
  return out;
}
