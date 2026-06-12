"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Email } from "@/lib/types";
import { cn } from "@/lib/utils";
import { displayName } from "./helpers";
import { LinkedText } from "./LinkedText";

/**
 * LINE-style conversation rendering: own messages (state "sent") on the
 * right, the other party on the left, with date dividers. Quoted reply
 * blocks (">" lines) are folded into a tap-to-expand toggle so bubbles stay
 * readable but nothing becomes unreachable (転送メールは全文が引用のため).
 */

type Segment = { kind: "text" | "quote"; body: string };

/** Split a body into alternating plain / quoted (">"-prefixed) segments. */
function splitQuotes(body: string): Segment[] {
  const segments: Segment[] = [];
  let buf: string[] = [];
  let quoting = false;
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) segments.push({ kind: quoting ? "quote" : "text", body: text });
    buf = [];
  };
  for (const line of body.split("\n")) {
    const isQuote = /^\s*>/.test(line);
    if (isQuote !== quoting) {
      flush();
      quoting = isQuote;
    }
    buf.push(isQuote ? line.replace(/^\s*>\s?/, "") : line);
  }
  flush();
  return segments;
}

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
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((m, i) => {
        const own = m.state === "sent";
        const day = dayKey(m.date);
        const divider = i === 0 || day !== dayKey(messages[i - 1].date);
        return (
          <div key={m.id} className="flex flex-col gap-2.5">
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
  const segments = splitQuotes(body);
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
        "min-w-0 rounded-2xl px-3.5 py-2.5 text-sm leading-6",
        own
          ? "rounded-br-md bg-accent text-accent-fg"
          : "rounded-bl-md border border-border bg-surface text-fg/90",
        // The message opened from the list — findable in a long conversation.
        current && "ring-2 ring-amber-300/80 dark:ring-amber-300/40",
      )}
    >
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return (
            <div key={i} className="whitespace-pre-wrap">
              <LinkedText text={seg.body} />
            </div>
          );
        }
        const lines = seg.body.split("\n").length;
        const expanded = open.has(i);
        return (
          <div key={i} className="my-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggle(i);
              }}
              className={cn(
                "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors",
                own
                  ? "text-accent-fg/80 hover:bg-white/10"
                  : "text-fg-subtle hover:bg-surface-2",
              )}
            >
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {expanded ? "引用をたたむ" : `引用 ${lines}行を表示`}
            </button>
            {expanded && (
              <div
                className={cn(
                  "mt-1 whitespace-pre-wrap border-l-2 pl-2.5 text-[13px] leading-5",
                  own ? "border-white/40 text-accent-fg/85" : "border-border text-fg-muted",
                )}
              >
                <LinkedText text={seg.body} />
              </div>
            )}
          </div>
        );
      })}
      {segments.length === 0 && <div className="whitespace-pre-wrap" />}
    </div>
  );
}
