"use client";

import { useState } from "react";
import { LinkedText } from "./LinkedText";
import { parseTerms } from "./highlight";

/** A line that introduces a quoted reply (kept with the quote when collapsing). */
function isAttribution(l: string): boolean {
  if (/^\s*>/.test(l)) return false; // a quote line itself, not the intro
  return (
    /<[^@\s]+@[^>\s]+>\s*(のメール)?\s*[:：]?\s*$/.test(l) || // "… 山田 <a@b.c>:" / "…<a@b.c>のメール:"（Gmail 日本語）
    /^On\b.*\bwrote:\s*$/.test(l) || // Gmail (EN)
    /^\d{4}年\d{1,2}月\d{1,2}日.*[:：]\s*$/.test(l) || // 日本語の日時引用（年月日）
    /^\d{4}[/／]\d{1,2}[/／]\d{1,2}.*[:：]\s*$/.test(l) || // "2026/09/04 14:36、… のメール:"（スラッシュ日付）
    /のメール\s*[:：]\s*$/.test(l) || // "…さんからのメール:" 系の締め
    /^-{2,}\s*(Original Message|元のメッセージ|転送メッセージ)\s*-{2,}/i.test(l) ||
    /^_{5,}$/.test(l) || // Outlook の区切り線
    /^(差出人|From)\s*[:：]/.test(l) // Outlook ヘッダブロック
  );
}

/**
 * Split a plain-text mail body into the new content (head) and the quoted
 * history (tail). Long threads are mostly quoted text repeated each reply, so
 * we hide it behind a "···" toggle (定番のメーラー挙動). Heuristic, plain-text
 * only — returns no quote when nothing recognizable is found.
 */
export function splitQuotedReply(text: string): { head: string; quoted: string } {
  const lines = text.split("\n");
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*>/.test(lines[i])) {
      cut = i;
      // Pull in an attribution line just above (skipping one blank line).
      let a = i - 1;
      if (a >= 0 && lines[a].trim() === "") a -= 1;
      if (a >= 0 && isAttribution(lines[a])) cut = a;
      break;
    }
    if (isAttribution(lines[i])) {
      cut = i;
      break;
    }
  }
  if (cut < 0) return { head: text, quoted: "" };
  const head = lines.slice(0, cut).join("\n").replace(/\s+$/, "");
  const quoted = lines.slice(cut).join("\n").trim();
  // Not worth a toggle for a trivial quote.
  if (quoted.length < 40) return { head: text, quoted: "" };
  return { head, quoted };
}

export type ReplySegment = { kind: "text" | "quote"; body: string };

/**
 * Segment a plain-text body into visible new text and foldable quoted blocks,
 * KEEPING interleaved (inline) replies visible. Unlike splitQuotedReply (one
 * cut → head/tail), this folds each quoted block in place, so a reply written
 * *below* a quoted line isn't swallowed into the fold (インライン返信で返答が
 * 一緒に畳まれる問題の対策).
 *
 * Rules: a ">"-prefixed run is one quote block; a recognized history header
 * (Original Message / From: / 日本語の引用書き出し …) folds from that line to
 * EOF; blank lines don't switch mode.
 */
export function segmentReply(raw: string): ReplySegment[] {
  const lines = raw.split("\n");
  const segs: ReplySegment[] = [];
  let buf: string[] = [];
  let mode: "text" | "quote" = "text";
  const flush = () => {
    const joined = mode === "quote" ? buf.join("\n").replace(/^\s*>\s?/gm, "") : buf.join("\n");
    const body = joined.replace(/^\n+/, "").replace(/\s+$/, "");
    if (body) segs.push({ kind: mode, body });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      buf.push(line); // blanks stay in the current block, never switch mode
      continue;
    }
    const isQuoteLine = /^\s*>/.test(line);
    if (!isQuoteLine && isAttribution(line)) {
      // A history header → everything from here to EOF is quoted history.
      flush();
      mode = "quote";
      buf = lines.slice(i);
      flush();
      return segs;
    }
    const want: "text" | "quote" = isQuoteLine ? "quote" : "text";
    if (want !== mode) {
      flush();
      mode = want;
    }
    buf.push(line);
  }
  flush();
  return segs;
}

/**
 * Display-time tidy for plain-text bodies whose source lost line structure —
 * e.g. Google/Teams calendar invites cram "■URL: … ■会議 ID: … ■パスコード: …"
 * onto one line. Break before a mid-line "■" bullet so each field is its own
 * line, and collapse over-long blank runs. Display only — the stored body is
 * untouched. (Only ■ is split; 中黒 "・" is a normal in-word char and left alone.)
 */
function tidyPlainBody(text: string): string {
  return text.replace(/([^\n])■/g, "$1\n■").replace(/\n{3,}/g, "\n\n");
}

/** Body text with each quoted block collapsed behind a "···" toggle, in place —
 *  new text written between/below quotes (inline replies) stays visible.
 *  `highlight` (search query) marks matches — set only when opened from search. */
export function QuotedText({ text: raw, highlight }: { text: string; highlight?: string }) {
  const text = tidyPlainBody(raw);
  const terms = parseTerms(highlight);
  const segs = segmentReply(text);
  // Which quote segments are expanded (index into segs). Search → expand all.
  const searching = terms.length > 0;
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  if (!segs.some((s) => s.kind === "quote")) return <LinkedText text={text} highlight={terms} />;

  return (
    <>
      {segs.map((seg, i) => {
        if (seg.kind === "text") {
          return (
            <div key={i} className="whitespace-pre-wrap">
              <LinkedText text={seg.body} highlight={terms} />
            </div>
          );
        }
        const expanded = searching || open.has(i);
        const lines = seg.body.split("\n").length;
        return (
          <div key={i} className="my-1">
            {!searching && (
              <button
                onClick={() => toggle(i)}
                title={expanded ? "引用（過去のやりとり）を隠す" : "引用（過去のやりとり）を表示"}
                className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-2 py-0.5 align-middle text-xs leading-none text-fg-subtle transition-colors hover:text-fg"
              >
                {expanded ? "引用を隠す" : `··· 引用 ${lines}行`}
              </button>
            )}
            {expanded && (
              <div className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3 text-fg-muted">
                <LinkedText text={seg.body} highlight={terms} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
