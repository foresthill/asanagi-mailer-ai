"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Email } from "@/lib/types";
import { cn } from "@/lib/utils";
import { displayName } from "./helpers";
import { LinkedText } from "./LinkedText";
import { segmentReply } from "./QuotedText";

/**
 * LINE-style conversation rendering: own messages (state "sent") on the
 * right, the other party on the left, with date dividers. The quoted reply
 * history (">" lines, "-----Original Message-----", "From:" header blocks,
 * 日本語の引用書き出し …) is detected with the shared splitQuotedReply and
 * folded into a tap-to-expand toggle, so a bubble shows only the NEW text and
 * doesn't balloon with the whole forwarded chain (転送メールは全文が引用のため).
 */

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ConversationBubbles({
  messages,
  selectedId,
}: {
  messages: Email[];
  /** The message opened from the list — gets a subtle amber ring. */
  selectedId?: string;
}) {
  // Land on the opened message (like card mode) — chat threads render oldest
  // first, so without this a long conversation opens at the top, not the
  // relevant/latest message.
  const selectedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      selectedRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
    return () => clearTimeout(t);
  }, [selectedId, messages.length]);
  // Per-message: show the full recipient list (vs truncated to one line).
  const [recipOpen, setRecipOpen] = useState<Set<string>>(new Set());
  const toggleRecip = (id: string) =>
    setRecipOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((m, i) => {
        const own = m.state === "sent";
        const day = dayKey(m.date);
        const divider = i === 0 || day !== dayKey(messages[i - 1].date);
        return (
          <div
            key={m.id}
            ref={m.id === selectedId ? selectedRef : undefined}
            className="flex scroll-mt-4 flex-col gap-2.5"
          >
            {divider && (
              <div className="my-1 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] text-fg-subtle">{day}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <div className={cn("flex flex-col", own ? "items-end" : "items-start")}>
              {!own && (
                <span className="mb-0.5 px-1 text-[11px] text-fg-subtle">
                  {displayName(m.from)}
                </span>
              )}
              {own && m.to.length > 0 && (
                <span
                  onClick={() => toggleRecip(m.id)}
                  className={cn(
                    "mb-0.5 max-w-[78%] cursor-pointer px-1 text-[11px] text-fg-subtle hover:text-fg",
                    recipOpen.has(m.id) ? "whitespace-normal break-words" : "truncate",
                  )}
                  title={[
                    `To: ${m.to.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}`,
                    m.cc?.length
                      ? `Cc: ${m.cc.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("\n")}
                >
                  宛先: {m.to.map((a) => a.name || a.email).join("、")}
                  {m.cc?.length ? `（CC: ${m.cc.map((a) => a.name || a.email).join("、")}）` : ""}
                </span>
              )}
              <div className={cn("flex max-w-[78%] items-end gap-1.5", own && "flex-row-reverse")}>
                <Bubble own={own} body={m.body || m.snippet} current={m.id === selectedId} />
                <span className="shrink-0 pb-0.5 text-[10px] text-fg-subtle">{timeOf(m.date)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Bubble({ own, body, current }: { own: boolean; body: string; current?: boolean }) {
  // Segment into new text + quoted blocks. Each quote block folds IN PLACE, so
  // a reply written below a quoted line (inline reply) stays visible instead of
  // being swallowed into the fold. Recognizes ">"-quotes, Original Message /
  // From: header blocks and 日本語の引用書き出し.
  const segs = segmentReply(body);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div
      className={cn(
        // break-words / overflow-wrap: long URLs & addresses must wrap, not
        // overflow the bubble (文字が突き抜ける問題).
        "min-w-0 max-w-full overflow-hidden rounded-2xl px-3.5 py-2.5 text-sm leading-6 break-words [overflow-wrap:anywhere]",
        own
          ? "rounded-br-md bg-accent text-accent-fg"
          : "rounded-bl-md border border-border bg-surface text-fg/90",
        // The message opened from the list — findable in a long conversation.
        current && "ring-2 ring-amber-300/80 dark:ring-amber-300/40",
      )}
    >
      {segs.map((seg, i) => {
        if (seg.kind === "text") {
          return (
            <div key={i} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              <LinkedText text={seg.body} />
            </div>
          );
        }
        const expanded = open.has(i);
        const lines = seg.body.split("\n").length;
        return (
          <div key={i} className="my-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggle(i);
              }}
              className={cn(
                "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors",
                own ? "text-accent-fg/80 hover:bg-white/10" : "text-fg-subtle hover:bg-surface-2",
              )}
            >
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {expanded ? "引用をたたむ" : `引用 ${lines}行を表示`}
            </button>
            {expanded && (
              <div
                className={cn(
                  "mt-1 whitespace-pre-wrap border-l-2 pl-2.5 text-[13px] leading-5 break-words [overflow-wrap:anywhere]",
                  own ? "border-white/40 text-accent-fg/85" : "border-border text-fg-muted",
                )}
              >
                <LinkedText text={seg.body} />
              </div>
            )}
          </div>
        );
      })}
      {segs.length === 0 && <div className="whitespace-pre-wrap" />}
    </div>
  );
}
