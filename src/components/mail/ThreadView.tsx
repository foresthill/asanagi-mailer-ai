"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Email } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, displayName, fullTime, initials } from "./helpers";

/**
 * Conversation rendering of a thread, oldest first. The latest message and
 * the one the user opened start expanded; the rest collapse to one line.
 * Own messages (state "sent") get a chip so the back-and-forth is scannable.
 */
export function ThreadView({ messages, selectedId }: { messages: Email[]; selectedId: string }) {
  const lastId = messages[messages.length - 1]?.id;
  const [open, setOpen] = useState<Set<string>>(
    () => new Set([selectedId, lastId].filter(Boolean) as string[]),
  );

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mt-6 flex flex-col gap-3">
      {messages.map((m) => {
        const name = displayName(m.from);
        const expanded = open.has(m.id);
        return (
          <div
            key={m.id}
            className={cn(
              "rounded-xl border border-border bg-surface transition-colors",
              expanded ? "" : "hover:border-accent/40",
            )}
          >
            <button
              onClick={() => toggle(m.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <div
                className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
                style={{ background: avatarColor(name) }}
              >
                {initials(m.from)}
              </div>
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{name}</span>
                  {m.state === "sent" && (
                    <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      自分
                    </span>
                  )}
                </span>
                {!expanded && (
                  <p className="truncate text-xs text-fg-subtle">{m.snippet}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-fg-subtle">{fullTime(m.date)}</span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-fg-subtle transition-transform",
                  expanded && "rotate-180",
                )}
              />
            </button>
            {expanded && (
              <article className="whitespace-pre-wrap border-t border-border px-4 py-4 text-[15px] leading-7 text-fg/90">
                {m.body}
              </article>
            )}
          </div>
        );
      })}
    </div>
  );
}
