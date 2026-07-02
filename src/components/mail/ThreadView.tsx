"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Loader2, MessageCircle, Paperclip, Rows3 } from "lucide-react";
import type { Email, Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, displayName, fullTime, initials } from "./helpers";
import { ConversationBubbles } from "./ConversationBubbles";
import { QuotedText } from "./QuotedText";
import { AttachmentList } from "./AttachmentList";
import { HtmlMailView } from "./HtmlMailView";

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

/** Full To/Cc/Bcc with addresses, for the recipient line's hover tooltip. */
function recipientTitle(m: Email): string {
  const fmt = (list?: { name?: string; email: string }[]) =>
    (list ?? []).map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
  return [
    `To: ${fmt(m.to)}`,
    m.cc?.length ? `Cc: ${fmt(m.cc)}` : "",
    m.bcc?.length ? `Bcc: ${fmt(m.bcc)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function ThreadView({
  messages,
  selectedId,
  onOpen,
}: {
  messages: Email[];
  selectedId: string;
  /** Re-anchor the reader to this message (open it as the current email). */
  onOpen?: (id: string) => void;
}) {
  const lastId = messages[messages.length - 1]?.id;
  const [view, setView] = useState<"cards" | "chat">(loadViewPref);
  const [open, setOpen] = useState<Set<string>>(
    () => new Set([selectedId, lastId].filter(Boolean) as string[]),
  );
  // Thread messages come from the cache without attachment metadata (only a
  // hasAttachment flag), so fetch a message's attachments on demand when it is
  // expanded — lets you dig up files from older messages without leaving the
  // thread. Deduped via a ref so each message is fetched at most once.
  // On expand, fetch the full message (html with inline images resolved +
  // attachment metadata) so cards render the same rich HTML as the single-mail
  // reader — quotes indent, inline images show, and attachments are reachable.
  const [fullMap, setFullMap] = useState<Record<string, { html?: string; attachments: Attachment[] }>>(
    {},
  );
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const fetchedRef = useRef<Set<string>>(new Set());
  // 📎 popover: which message's attachment bubble is open.
  const [attPopover, setAttPopover] = useState<string | null>(null);
  const loadFull = useCallback((id: string) => {
    if (fetchedRef.current.has(id)) return;
    fetchedRef.current.add(id);
    setLoading((s) => new Set(s).add(id));
    fetch(`/api/emails/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) =>
        setFullMap((prev) => ({
          ...prev,
          [id]: { html: d?.email?.html, attachments: d?.email?.attachments ?? [] },
        })),
      )
      .catch(() => {
        /* best-effort — fall back to the cached plain-text body */
      })
      .finally(() =>
        setLoading((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        }),
      );
  }, []);
  useEffect(() => {
    for (const m of messages) if (open.has(m.id)) loadFull(m.id);
  }, [open, messages, loadFull]);
  // Long threads (10–20 messages) make the opened message (amber) require a lot
  // of scrolling. On open, scroll that message into view automatically.
  const currentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view !== "cards") return; // chat mode scrolls itself
    const t = setTimeout(() => {
      // Land on the TOP of the opened message (not centered/bottom) so reading
      // starts at its head.
      currentRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
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
            <div className="flex w-full items-center gap-2 px-4 py-3">
              <button
                onClick={() => toggle(m.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
                  {m.to.length > 0 && (
                    <span
                      title={recipientTitle(m)}
                      className={cn(
                        "block text-xs text-fg-subtle",
                        // Open the card → recipients expand with the body (one click).
                        expanded ? "whitespace-normal break-words" : "truncate",
                      )}
                    >
                      宛先: {m.to.map((a) => a.name || a.email).join("、")}
                      {m.cc?.length ? `（CC: ${m.cc.map((a) => a.name || a.email).join("、")}）` : ""}
                    </span>
                  )}
                  {!expanded && (
                    <p className="truncate text-xs text-fg-subtle">{m.snippet}</p>
                  )}
                </div>
              </button>
              {/* 📎 → download bubble right here (no scrolling up to the top). */}
              {m.hasAttachment && (
                <div className="relative shrink-0">
                  <button
                    onClick={() => {
                      loadFull(m.id);
                      setAttPopover((p) => (p === m.id ? null : m.id));
                    }}
                    title="添付ファイル"
                    aria-label="添付ファイルを表示"
                    className={cn(
                      "grid size-7 place-items-center rounded-md transition-colors",
                      attPopover === m.id
                        ? "bg-accent-soft text-accent"
                        : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    <Paperclip className="size-4" />
                  </button>
                  {attPopover === m.id && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setAttPopover(null)} />
                      <div className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[80vw] rounded-lg border border-border bg-surface p-2 shadow-[var(--shadow)]">
                        {fullMap[m.id]?.attachments?.length ? (
                          <AttachmentList emailId={m.id} attachments={fullMap[m.id].attachments} bare />
                        ) : (
                          <p className="flex items-center gap-1.5 px-1 py-1.5 text-xs text-fg-subtle">
                            <Loader2 className="size-3.5 animate-spin" /> 添付を読み込み中…
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
              <button
                onClick={() => toggle(m.id)}
                className="flex shrink-0 items-center gap-1"
              >
                <span className="text-xs text-fg-subtle">{fullTime(m.date)}</span>
                <ChevronDown
                  className={cn(
                    "size-4 text-fg-subtle transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </button>
            </div>
            {expanded && (
              <div className="rounded-b-xl border-t border-border bg-surface px-4 py-4">
                {onOpen && m.id !== selectedId && (
                  <div className="mb-2 flex justify-end">
                    <button
                      onClick={() => onOpen(m.id)}
                      title="このメールをリーダーで開く（返信・重要学習などに使えます）"
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-accent"
                    >
                      このメールを開く
                      <ArrowUpRight className="size-3" />
                    </button>
                  </div>
                )}
                {/* This message's own attachments (the anchor's show at the top
                    of the reader; other messages' show here). Gate on the
                    actually-fetched list, not the cached hasAttachment flag —
                    the flag can be stale (e.g. an inline-tagged file cached
                    before detection improved), which would hide real files. */}
                {m.id !== selectedId && fullMap[m.id]?.attachments?.length ? (
                  <AttachmentList emailId={m.id} attachments={fullMap[m.id].attachments} />
                ) : null}
                {/* Body: rich HTML (indented quotes + inline images) once loaded;
                    plain text fallback while fetching or when there's no HTML. */}
                {fullMap[m.id]?.html ? (
                  <HtmlMailView html={fullMap[m.id].html!} embedded />
                ) : loading.has(m.id) && !m.body ? (
                  <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
                    <Loader2 className="size-3.5 animate-spin" /> 読み込み中…
                  </p>
                ) : (
                  <article className="whitespace-pre-wrap text-[15px] leading-7 text-fg/90">
                    <QuotedText text={m.body} />
                  </article>
                )}
              </div>
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
