"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Loader2,
  MessageCircle,
  Paperclip,
  Rows3,
  Sparkles,
} from "lucide-react";
import type { Email, Attachment } from "@/lib/types";
import type { ComposeAI, ComposeKind } from "./compose";
import { ReplyButton, AiReplyButton } from "./ReplyButtons";
import { cn } from "@/lib/utils";
import { avatarColor, displayName, fullTime, initials } from "./helpers";
import { ConversationBubbles } from "./ConversationBubbles";
import { QuotedText } from "./QuotedText";
import { SelectableText } from "./SelectableText";
import { AttachmentList } from "./AttachmentList";
import { HtmlMailView } from "./HtmlMailView";

/**
 * Thread rendering, oldest first, with two display modes:
 *  - cards: collapsible message cards (latest + opened start expanded)
 *  - chat:  LINE-style bubbles (own messages right) via ConversationBubbles
 * The choice is a personal preference, so it persists across emails and
 * sessions (localStorage) — default is the classic mailer card view.
 */
/** Shape returned by /api/ai/thread-digest (kept local to avoid importing a
 *  server route into a client component). */
interface ThreadDigest {
  summary: string;
  decisions: string[];
  open: string[];
  nextActions: string[];
  keyDates: string[];
  participants: string[];
}

const VIEW_PREF_KEY = "asanagi:thread-view";

type ViewMode = "cards" | "chat";

function loadViewPref(): ViewMode {
  if (typeof window === "undefined") return "cards";
  return localStorage.getItem(VIEW_PREF_KEY) === "chat" ? "chat" : "cards";
}

/** Full To/Cc/Bcc with addresses, for the recipient line's hover tooltip. */
function recipientTitle(m: Email): string {
  const fmt = (list?: { name?: string; email: string }[]) =>
    (list ?? [])
      .map((a) => (a.name ? `${a.name} <${a.email}>` : a.email))
      .join(", ");
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
  onReplyMessage,
  anchorHtml,
  anchorAttachments,
  highlight,
  expandId,
  expandNonce,
}: {
  messages: Email[];
  selectedId: string;
  /** Rail-jump request from the reader: expand this message's card. */
  expandId?: string;
  /** Bumps per rail click so repeat clicks on the same message re-fire. */
  expandNonce?: number;
  /** Re-anchor the reader to this message (open it as the current email). */
  onOpen?: (id: string) => void;
  /** Reply/forward to THIS specific message (per-message action buttons). */
  onReplyMessage?: (id: string, kind: ComposeKind, mode: ComposeAI) => void;
  /** The anchor message's already-loaded rich body / attachments (the reader
   *  fetched them), so its card renders instantly without a second round-trip. */
  anchorHtml?: string;
  anchorAttachments?: Attachment[];
  /** Search query to highlight in plain-text card bodies (search mode only). */
  highlight?: string;
}) {
  const lastId = messages[messages.length - 1]?.id;
  const [view, setView] = useState<ViewMode>(loadViewPref);
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
  const [fullMap, setFullMap] = useState<
    Record<string, { html?: string; attachments: Attachment[] }>
  >({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const fetchedRef = useRef<Set<string>>(new Set());
  const loadFull = useCallback((id: string) => {
    if (fetchedRef.current.has(id)) return;
    fetchedRef.current.add(id);
    setLoading((s) => new Set(s).add(id));
    fetch(`/api/emails/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) =>
        setFullMap((prev) => ({
          ...prev,
          [id]: {
            html: d?.email?.html,
            attachments: d?.email?.attachments ?? [],
          },
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
  // Auto-scroll to the opened message ONCE per open — not on every messages
  // update. Otherwise a late thread refresh (server-side thread() lands after
  // the cache paint) re-fires this and yanks you back while you're scrolling up
  // through the history (ばーっと過去を遡れない問題).
  const scrolledFor = useRef<string | null>(null);
  // クリックした（検索結果などから開いた）メッセージは常に展開する。ThreadView は
  // メール切替で再マウントされず open の初期化が走らないため、selectedId が変わる
  // たびに必ず開く（＝最新の自分の返信ではなく、クリックしたメールが開いて出る）。
  useEffect(() => {
    if (!selectedId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded (no-op if already open)
    setOpen((prev) => {
      if (prev.has(selectedId)) return prev;
      const next = new Set(prev);
      next.add(selectedId);
      return next;
    });
  }, [selectedId]);
  useEffect(() => {
    if (view !== "cards" || !selectedId || scrolledFor.current === selectedId)
      return;
    const t = setTimeout(() => {
      // Wait until the anchor is actually in the DOM (messages may still be
      // loading) — only then count it as scrolled so we don't retry forever.
      if (currentRef.current) {
        // Instant jump ("ピッと") — smooth scrolling across a long thread feels
        // slow; snap straight to the opened message instead.
        currentRef.current.scrollIntoView({ block: "start", behavior: "auto" });
        scrolledFor.current = selectedId;
      }
    }, 30); // brief tick so the just-rendered anchor is measurable
    return () => clearTimeout(t);
  }, [selectedId, messages.length, view]);

  const changeView = (v: ViewMode) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_PREF_KEY, v);
    } catch {
      /* private mode etc. — preference just won't stick */
    }
  };

  // The outline rail lives in the reader's left gutter (EmailReader). When a
  // rail item is clicked it asks us to expand that message's card so the reader
  // can scroll to it. expandNonce bumps each request so repeat clicks re-fire.
  useEffect(() => {
    if (!expandId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded (no-op if already open)
    setOpen((prev) =>
      prev.has(expandId) ? prev : new Set(prev).add(expandId),
    );
  }, [expandId, expandNonce]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 経緯ダイジェスト（AI要約）— クリック時だけ実行（自動生成しない＝勝手に課金しない）。
  const [digest, setDigest] = useState<ThreadDigest | null>(null);
  const [digesting, setDigesting] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);
  const runDigest = async () => {
    setDigesting(true);
    setDigestError(null);
    try {
      const res = await fetch("/api/ai/thread-digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "要約に失敗しました");
      setDigest(data.digest as ThreadDigest);
    } catch (e) {
      setDigestError(e instanceof Error ? e.message : "要約に失敗しました");
    } finally {
      setDigesting(false);
    }
  };

  const digestSection = messages.length > 1 && (
    <div>
      {!digest && (
        <button
          onClick={runDigest}
          disabled={digesting}
          title="この会話の経緯をAIが要約（本文はPIIマスクして送信）"
          className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent transition hover:opacity-90 disabled:opacity-60"
        >
          {digesting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {digesting ? "経緯を要約中…" : "この会話の経緯を要約"}
        </button>
      )}
      {digestError && <p className="mt-1 text-xs text-high">{digestError}</p>}
      {digest && (
        <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow)]">
          <div className="mb-2 flex items-center gap-1.5">
            <Sparkles className="size-4 text-accent" />
            <span className="text-sm font-semibold">経緯ダイジェスト</span>
            <button
              onClick={runDigest}
              disabled={digesting}
              className="ml-auto text-[11px] text-fg-subtle hover:text-fg disabled:opacity-60"
            >
              {digesting ? "…" : "再生成"}
            </button>
            <button
              onClick={() => setDigest(null)}
              className="text-[11px] text-fg-subtle hover:text-fg"
            >
              閉じる
            </button>
          </div>
          {digest.summary && (
            <p className="whitespace-pre-wrap text-sm leading-6 text-fg/90">
              {digest.summary}
            </p>
          )}
          <DigestList label="決定事項" items={digest.decisions} />
          <DigestList label="未決・宿題" items={digest.open} />
          <DigestList label="次アクション" items={digest.nextActions} />
          <DigestList label="キー日付" items={digest.keyDates} />
          <DigestList label="登場人物" items={digest.participants} />
          <p className="mt-3 text-[10px] text-fg-subtle">
            AIが会話を要約（PIIはマスクして送信）。重要な点は原文でご確認ください。
          </p>
        </div>
      )}
    </div>
  );

  const switcher = (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-xs text-fg-subtle">
        {messages.length}通の会話
      </span>
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

  // Pin the mode switcher: in a long thread the reader auto-scrolls down to the
  // opened message, so a top-anchored toolbar would be buried far above. Sticky
  // keeps カード/会話 reachable while reading anywhere in the thread.
  const switcherBar = (
    <div className="sticky top-0 z-20 mb-1 flex justify-end bg-bg/85 py-2 backdrop-blur">
      {switcher}
    </div>
  );

  if (view === "chat") {
    return (
      <div className="mt-6 flex flex-col gap-3">
        {switcherBar}
        {digestSection}
        <ConversationBubbles messages={messages} selectedId={selectedId} />
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      {switcherBar}
      {digestSection}
      <div className="flex flex-col gap-3">
        {messages.map((m) => {
          const name = displayName(m.from);
          const expanded = open.has(m.id);
          // The message the user opened from the list — subtle amber tint so
          // it's findable inside a long conversation.
          const current = m.id === selectedId;
          // Effective rich data: the on-demand fetch, or — for the anchor — the
          // reader's already-loaded body/attachments so it shows instantly.
          const full =
            fullMap[m.id] ??
            (current
              ? { html: anchorHtml, attachments: anchorAttachments ?? [] }
              : undefined);
          return (
            <div
              key={m.id}
              id={`thread-msg-${m.id}`}
              ref={current ? currentRef : undefined}
              className={cn(
                "rounded-xl border transition-colors scroll-mt-4",
                current
                  ? "border-amber-300/70 bg-amber-50/60 dark:border-amber-300/30 dark:bg-amber-400/10"
                  : m.state === "sent"
                    ? // 自分の送信は accent 寄りに色付け（一目で自分の発言と分かる）
                      "border-accent/40 bg-accent-soft/50"
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
                    style={{ background: avatarColor(m.from.email) }}
                  >
                    {initials(m.from)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {name}
                      </span>
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
                          expanded
                            ? "whitespace-normal break-words"
                            : "truncate",
                        )}
                      >
                        宛先: {m.to.map((a) => a.name || a.email).join("、")}
                        {m.cc?.length
                          ? `（CC: ${m.cc.map((a) => a.name || a.email).join("、")}）`
                          : ""}
                      </span>
                    )}
                    {!expanded && (
                      <p className="truncate text-xs text-fg-subtle">
                        {m.snippet}
                      </p>
                    )}
                  </div>
                </button>
                {/* 📎 → download bubble right here (no scrolling up to the top). */}
                {/* Attachment indicator → expand the card so the files show
                  inline (in-thread, not a detached popover). */}
                {m.hasAttachment && (
                  <button
                    onClick={() => setOpen((prev) => new Set(prev).add(m.id))}
                    title="添付ファイル（展開して表示）"
                    aria-label="添付ファイルを表示"
                    className="grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    <Paperclip className="size-4" />
                  </button>
                )}
                <button
                  onClick={() => toggle(m.id)}
                  className="flex shrink-0 items-center gap-1"
                >
                  <span className="text-xs text-fg-subtle">
                    {fullTime(m.date)}
                  </span>
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
                  {/* Per-message actions: same split buttons as the reader bar
                    (返信/AIで返信＋メニューに 全員に返信/AIで全員に返信/転送) so
                    it's clear which mail you're answering — no scrolling up. */}
                  {(onReplyMessage || (onOpen && m.id !== selectedId)) && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {onReplyMessage && (
                        <>
                          <ReplyButton
                            onReply={(kind, mode) =>
                              onReplyMessage(m.id, kind, mode)
                            }
                          />
                          <AiReplyButton
                            onReply={(kind, mode) =>
                              onReplyMessage(m.id, kind, mode)
                            }
                          />
                        </>
                      )}
                      {onOpen && m.id !== selectedId && (
                        <button
                          onClick={() => onOpen(m.id)}
                          title="このメールをリーダーで開く（重要学習などに使えます）"
                          className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-accent"
                        >
                          このメールを開く
                          <ArrowUpRight className="size-3" />
                        </button>
                      )}
                    </div>
                  )}
                  {/* Each message's attachments render inline in its own card —
                    including the anchor — so the whole thread is consistent.
                    Gate on the actually-fetched list, not the cached
                    hasAttachment flag (which can be stale and hide real files). */}
                  {full?.attachments?.length ? (
                    <AttachmentList
                      emailId={m.id}
                      attachments={full.attachments}
                    />
                  ) : m.hasAttachment ? (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-xs text-fg-muted">
                      <Loader2 className="size-3.5 animate-spin" />
                      添付ファイルを読み込み中…
                    </div>
                  ) : null}
                  {/* Body: rich HTML (indented quotes + inline images) once loaded;
                    plain text fallback while fetching or when there's no HTML. */}
                  {full?.html ? (
                    <HtmlMailView
                      html={full.html}
                      embedded
                      highlight={highlight}
                    />
                  ) : loading.has(m.id) && !m.body ? (
                    <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
                      <Loader2 className="size-3.5 animate-spin" /> 読み込み中…
                    </p>
                  ) : (
                    <SelectableText className="whitespace-pre-wrap text-[15px] leading-7 text-fg/90">
                      <QuotedText text={m.body} highlight={highlight} />
                    </SelectableText>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A labelled bullet list in the digest card; renders nothing when empty. */
function DigestList({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-2.5">
      <p className="text-[11px] font-semibold text-fg-muted">{label}</p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 text-[13px] text-fg/90">
            <span className="text-accent">・</span>
            <span className="min-w-0">{it}</span>
          </li>
        ))}
      </ul>
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
