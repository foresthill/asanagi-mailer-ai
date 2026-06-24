"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, MessageCircle, Rows3 } from "lucide-react";
import type { Email } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, displayName, fullTime, initials } from "./helpers";
import { ConversationBubbles } from "./ConversationBubbles";
import { LinkedText } from "./LinkedText";

/**
 * Thread rendering, oldest first, with two display modes:
 *  - cards: collapsible message cards (latest + opened start expanded)
 *  - chat:  LINE-style bubbles (own messages right) via ConversationBubbles
 * The choice is a personal preference, so it persists across emails and
 * sessions (localStorage) — default is the classic mailer card view.
 */
const VIEW_PREF_KEY = "asanagi:thread-view";

function loadViewPref(): "cards" | "chat" {
  if (typeof window === "undefined") return "cards";
  return localStorage.getItem(VIEW_PREF_KEY) === "chat" ? "chat" : "cards";
}

export function ThreadView({ messages, selectedId }: { messages: Email[]; selectedId: string }) {
  const lastId = messages[messages.length - 1]?.id;
  const [view, setView] = useState<"cards" | "chat">(loadViewPref);
  const [open, setOpen] = useState<Set<string>>(
    () => new Set([selectedId, lastId].filter(Boolean) as string[]),
  );
  // Long threads (10–20 messages) make the opened message (amber) require a lot
  // of scrolling. On open, scroll that message into view automatically.
  const currentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view !== "cards") return; // chat mode scrolls itself
    const t = setTimeout(() => {
      currentRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80); // let the reader's enter animation settle first
    return () => clearTimeout(t);
  }, [selectedId, messages.length, view]);

  const changeView = (v: "cards" | "chat") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_PREF_KEY, v);
    } catch {
      /* private mode etc. — preference just won't stick */
    }
  };

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const switcher = (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-xs text-fg-subtle">{messages.length}通の会話</span>
      <ModeButton
        icon={Rows3}
        label="カード"
        active={view === "cards"}
        onClick={() => changeView("cards")}
      />
      <ModeButton
        icon={MessageCircle}
        label="会話"
        active={view === "chat"}
        onClick={() => changeView("chat")}
      />
    </div>
  );

  if (view === "chat") {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <div className="flex justify-end">{switcher}</div>
        <ConversationBubbles messages={messages} selectedId={selectedId} />
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex justify-end">{switcher}</div>
      {messages.map((m) => {
        const name = displayName(m.from);
        const expanded = open.has(m.id);
        // The message the user opened from the list — subtle amber tint so
        // it's findable inside a long conversation.
        const current = m.id === selectedId;
        return (
          <div
            key={m.id}
            ref={current ? currentRef : undefined}
            className={cn(
              "rounded-xl border transition-colors scroll-mt-4",
              current
                ? "border-amber-300/70 bg-amber-50/60 dark:border-amber-300/30 dark:bg-amber-400/10"
                : "border-border bg-surface",
              expanded || current ? "" : "hover:border-accent/40",
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
                <LinkedText text={m.body} />
              </article>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ModeButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Rows3;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border text-fg-muted hover:text-fg",
      )}
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
}
