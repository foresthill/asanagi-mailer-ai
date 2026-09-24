"use client";

import { Paperclip } from "lucide-react";
import type { Email } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, bodyPreview, displayName } from "./helpers";

/**
 * Document-style outline rail: an always-visible table of contents beside the
 * conversation. One line per message (差出人＋日付＋要点); the message you're
 * reading (現在地) is highlighted via scroll-spy, and clicking jumps to it.
 * Sticky so it stays put while you scroll. Rendered in the reader's LEFT gutter
 * so the mail body keeps its width.
 */
export function ThreadOutlineRail({
  messages,
  activeId,
  onJump,
}: {
  messages: Email[];
  activeId: string;
  onJump: (id: string) => void;
}) {
  return (
    <nav
      aria-label="スレッドのアウトライン"
      className="sticky top-2 hidden max-h-[calc(100vh-8rem)] w-52 shrink-0 self-start overflow-y-auto lg:block"
    >
      <ul className="flex flex-col">
        {messages.map((m) => {
          const active = m.id === activeId;
          const sent = m.state === "sent";
          const who = sent ? "自分" : displayName(m.from);
          const d = new Date(m.date);
          const md = `${d.getMonth() + 1}/${d.getDate()}`;
          const preview = bodyPreview(m) || "（本文なし）";
          return (
            <li key={m.id}>
              <button
                onClick={() => onJump(m.id)}
                title={`${who}｜${preview}`}
                className={cn(
                  "flex w-full flex-col gap-0.5 border-l-2 py-1.5 pl-2 pr-1.5 text-left leading-tight transition-colors",
                  active
                    ? "border-accent bg-accent-soft/50 text-fg"
                    : "border-border text-fg-subtle hover:border-fg-subtle hover:text-fg",
                )}
              >
                <span className="flex w-full items-center gap-1.5 text-[11px]">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: avatarColor(m.from.email) }}
                  />
                  <span className={cn("truncate", active && "font-semibold")}>
                    {who}
                  </span>
                  {m.hasAttachment && (
                    <Paperclip className="size-2.5 shrink-0 opacity-70" />
                  )}
                  <span className="ml-auto shrink-0 text-[10px] tabular-nums opacity-70">
                    {md}
                  </span>
                </span>
                <span className="line-clamp-2 w-full text-[10px] text-fg-subtle">
                  {preview}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
