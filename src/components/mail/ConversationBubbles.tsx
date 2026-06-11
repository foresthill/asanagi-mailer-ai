"use client";

import type { Email } from "@/lib/types";
import { cn } from "@/lib/utils";
import { displayName } from "./helpers";

/**
 * LINE-style conversation rendering: own messages (state "sent") on the
 * right, the other party on the left, with date dividers. Quoted reply
 * blocks (">" lines) are folded so bubbles stay readable.
 */

function foldQuotes(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let quoted = 0;
  const flush = () => {
    if (quoted > 0) out.push(`― 引用 ${quoted}行を省略 ―`);
    quoted = 0;
  };
  for (const line of lines) {
    if (/^\s*>/.test(line)) {
      quoted++;
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join("\n").trim();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ConversationBubbles({ messages }: { messages: Email[] }) {
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
                <div
                  className={cn(
                    "whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6",
                    own
                      ? "rounded-br-md bg-accent text-accent-fg"
                      : "rounded-bl-md border border-border bg-surface text-fg/90",
                  )}
                >
                  {foldQuotes(m.body) || m.snippet}
                </div>
                <span className="shrink-0 pb-0.5 text-[10px] text-fg-subtle">{timeOf(m.date)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
