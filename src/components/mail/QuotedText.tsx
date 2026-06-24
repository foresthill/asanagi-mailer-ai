"use client";

import { useState } from "react";
import { LinkedText } from "./LinkedText";

/** A line that introduces a quoted reply (kept with the quote when collapsing). */
function isAttribution(l: string): boolean {
  if (/^\s*>/.test(l)) return false; // a quote line itself, not the intro
  return (
    /<[^@\s]+@[^>\s]+>\s*[:：]?\s*$/.test(l) || // "… 山田 <a@b.c>:"（自作引用含む）
    /^On\b.*\bwrote:\s*$/.test(l) || // Gmail (EN)
    /^\d{4}年\d{1,2}月\d{1,2}日.*[:：]\s*$/.test(l) || // 日本語の日時引用
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

/** Body text with the quoted history collapsed behind a "···" toggle. */
export function QuotedText({ text }: { text: string }) {
  const { head, quoted } = splitQuotedReply(text);
  const [show, setShow] = useState(false);

  if (!quoted) return <LinkedText text={text} />;

  return (
    <>
      {head && <LinkedText text={head} />}
      <button
        onClick={() => setShow((s) => !s)}
        title={show ? "引用（過去のやりとり）を隠す" : "引用（過去のやりとり）を表示"}
        className="my-1.5 inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-2 py-0.5 align-middle text-xs leading-none text-fg-subtle transition-colors hover:text-fg"
      >
        {show ? "引用を隠す" : "···"}
      </button>
      {show && (
        <div className="mt-1 border-l-2 border-border pl-3 text-fg-muted">
          <LinkedText text={quoted} />
        </div>
      )}
    </>
  );
}
