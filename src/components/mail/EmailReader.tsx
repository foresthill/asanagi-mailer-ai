"use client";

import { useEffect, useState } from "react";
import {
  Archive,
  Trash2,
  Mail,
  Sparkles,
  RotateCcw,
  Loader2,
  Reply,
  ReplyAll,
  Forward,
  ChevronDown,
  Star,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Copy,
  Check,
} from "lucide-react";
import type { Email, FolderView, Importance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, displayName, fullTime, initials } from "./helpers";
import { ThreadView } from "./ThreadView";
import { QuotedText, splitQuotedReply } from "./QuotedText";
import { MeetingCard } from "./MeetingCard";
import { AttachmentList } from "./AttachmentList";
import { HtmlMailView } from "./HtmlMailView";
import { PrivateNote } from "./PrivateNote";
import type { ComposeAI, ComposeKind } from "./compose";

const IMPORTANCE_LABEL: Record<Importance, string> = {
  high: "重要",
  normal: "通常",
  low: "低",
};

export function EmailReader({
  email,
  thread,
  folder,
  classifying,
  onArchive,
  onTrash,
  onRestore,
  onReply,
  onToggleStar,
  onImportanceFeedback,
  onNoteSaved,
  onOpenMessage,
}: {
  email: Email | null;
  /** Conversation containing the email (oldest first); null while loading. */
  thread: Email[] | null;
  folder: FolderView;
  classifying: boolean;
  onArchive: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onReply: (kind: ComposeKind, mode: ComposeAI) => void;
  onToggleStar: () => void;
  onImportanceFeedback: (importance: Importance) => void;
  /** A private note was saved/cleared → refresh the list 📝 indicator. */
  onNoteSaved?: () => void;
  /** Re-anchor the reader to a thread message (open it as the current email). */
  onOpenMessage?: (id: string) => void;
}) {
  // Session-sticky preference: rich HTML (default) vs plain text.
  const [textMode, setTextMode] = useState(false);
  // 全画面（画面共有向け）＋本文の文字サイズ拡大。
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const zoomOut = () => setZoom((z) => Math.max(0.8, Math.round((z - 0.1) * 10) / 10));
  const zoomIn = () => setZoom((z) => Math.min(2.5, Math.round((z + 0.1) * 10) / 10));
  const [copied, setCopied] = useState(false);

  // Esc で全画面を解除。
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  if (!email) {
    return (
      <div className="grid flex-1 place-items-center bg-bg">
        <div className="flex flex-col items-center gap-3 text-fg-subtle">
          <Mail className="size-10 opacity-40" />
          <p className="text-sm">メールを選択してください</p>
        </div>
      </div>
    );
  }

  // Reply opens the composer (rendered outside this overlay), so leave
  // fullscreen first or it would be hidden behind the fixed reader.
  const replyAndExitFullscreen = (kind: ComposeKind, mode: ComposeAI) => {
    setFullscreen(false);
    onReply(kind, mode);
  };

  // Copy the new body text only — the quoted reply history is excluded, any
  // leftover CSS/style block is dropped, and long blank runs collapse to one
  // blank line (HTML mail otherwise pastes with big gaps).
  const copyBody = async () => {
    const { head } = splitQuotedReply(email.body);
    const text = (head.trim() || email.body)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t 　]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  const name = displayName(email.from);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-bg",
        fullscreen ? "fixed inset-0 z-50" : "flex-1",
      )}
    >
      {/* Action bar — concept: one accent primary (返信), quiet icon-only
          secondaries grouped by meaning (①仕分け ｜ ②表示 … 右 ③返信). */}
      <div className="flex items-center gap-0.5 border-b border-border bg-surface px-4 py-2">
        {/* ① 仕分け */}
        <IconBtn
          icon={Star}
          title={email.starred ? "スターを外す (S)" : "スターを付ける (S)"}
          onClick={onToggleStar}
          active={email.starred}
          tone="star"
        />
        {folder !== "archived" && folder !== "sent" && (
          <IconBtn icon={Archive} title="アーカイブ" onClick={onArchive} />
        )}
        {folder !== "trashed" ? (
          <IconBtn icon={Trash2} title="ゴミ箱" onClick={onTrash} tone="danger" />
        ) : (
          <IconBtn icon={RotateCcw} title="受信箱に戻す" onClick={onRestore} />
        )}

        <Divider />

        {/* ② 表示 */}
        <IconBtn
          icon={copied ? Check : Copy}
          title={copied ? "コピーしました" : "本文をコピー（引用部分は除く）"}
          onClick={copyBody}
          tone={copied ? "ok" : undefined}
        />
        <div className="ml-0.5 flex items-center gap-0.5 rounded-lg border border-border px-1 py-0.5">
          <button
            onClick={zoomOut}
            disabled={zoom <= 0.8}
            title="文字を小さく"
            className="grid size-6 place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            title="文字サイズをリセット"
            className="min-w-[2.5rem] rounded px-1 text-center text-[11px] tabular-nums text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={zoomIn}
            disabled={zoom >= 2.5}
            title="文字を大きく"
            className="grid size-6 place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
          >
            <ZoomIn className="size-3.5" />
          </button>
        </div>
        <IconBtn
          icon={fullscreen ? Minimize2 : Maximize2}
          title={fullscreen ? "全画面を解除 (Esc)" : "全画面表示（画面共有向け）"}
          onClick={() => setFullscreen((v) => !v)}
          active={fullscreen}
        />

        {/* ③ 返信（主役） */}
        <div className="ml-auto flex items-center gap-1.5">
          <ReplyButton onReply={replyAndExitFullscreen} />
          <AiReplyButton onReply={replyAndExitFullscreen} />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-7">
        <div className={cn("mx-auto animate-in", fullscreen ? "max-w-5xl" : "max-w-2xl")}>
          <h2 className="text-xl font-semibold leading-snug tracking-tight">{email.subject}</h2>

          <div className="mt-4 flex items-center gap-3">
            <div
              className="grid size-10 place-items-center rounded-full text-sm font-semibold text-white"
              style={{ background: avatarColor(name) }}
            >
              {initials(email.from)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{name}</p>
              <p className="truncate text-xs text-fg-subtle">{email.from.email}</p>
              {email.to.length > 0 && (
                <p
                  className="truncate text-xs text-fg-subtle"
                  title={[
                    `To: ${email.to.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}`,
                    email.cc?.length
                      ? `Cc: ${email.cc.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}`
                      : "",
                    email.bcc?.length
                      ? `Bcc: ${email.bcc.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("\n")}
                >
                  宛先: {email.to.map((a) => a.name || a.email).join("、")}
                  {email.cc?.length ? `（CC: ${email.cc.map((a) => a.name || a.email).join("、")}）` : ""}
                  {/* BCC exists only on our own sent copies — the sending record. */}
                  {email.bcc?.length
                    ? `（BCC: ${email.bcc.map((a) => a.name || a.email).join("、")}）`
                    : ""}
                </p>
              )}
            </div>
            <span className="ml-auto text-xs text-fg-subtle">{fullTime(email.date)}</span>
          </div>

          {/* Meeting invite → calendar bridge (docs/05) */}
          {email.invite && <MeetingCard emailId={email.id} invite={email.invite} />}

          {email.attachments && email.attachments.length > 0 && (
            <AttachmentList emailId={email.id} attachments={email.attachments} />
          )}

          {/* AI importance */}
          <ImportanceBar
            email={email}
            classifying={classifying}
            onFeedback={onImportanceFeedback}
          />

          {/* 自分用メモ（端末内のみ・AIに渡さない） */}
          <PrivateNote emailId={email.id} onSaved={onNoteSaved} />

          {thread && thread.length > 1 ? (
            <ThreadView messages={thread} selectedId={email.id} onOpen={onOpenMessage} />
          ) : (
            <>
              {email.html && (
                <div className="mt-3 flex justify-end gap-1">
                  <BodyModeButton
                    label="HTML"
                    active={!textMode}
                    onClick={() => setTextMode(false)}
                  />
                  <BodyModeButton
                    label="テキスト"
                    active={textMode}
                    onClick={() => setTextMode(true)}
                  />
                </div>
              )}
              {email.html && !textMode ? (
                <HtmlMailView html={email.html} fontScale={zoom} />
              ) : (
                <article
                  className="mt-6 whitespace-pre-wrap leading-7 text-fg/90"
                  style={{ fontSize: `${Math.round(15 * zoom)}px` }}
                >
                  <QuotedText text={email.body} />
                </article>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BodyModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 text-[11px] transition-colors",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border text-fg-muted hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

/** Primary AI action with a small menu: AIで返信 (default) / AIで全員に返信. */
/** Plain reply as a split button — 返信 primary, 全員に返信/転送 in a menu
 *  (rarely used, so collapsed to avoid the action bar wrapping). */
function ReplyButton({ onReply }: { onReply: (kind: ComposeKind, mode: ComposeAI) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div className="flex items-center overflow-hidden rounded-lg border border-border bg-surface">
        <button
          onClick={() => onReply("reply", "plain")}
          title="自分で書く返信 (Shift+R)"
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Reply className="size-4" />
          返信
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          title="全員に返信・転送"
          className="grid h-full place-items-center border-l border-border px-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow)]">
            <button
              onClick={() => {
                setOpen(false);
                onReply("replyAll", "plain");
              }}
              title="全員に返信 — 差出人＋To＋CCを引継ぎ (A)"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <ReplyAll className="size-4" />
              全員に返信
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onReply("forward", "plain");
              }}
              title="転送 (F)"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <Forward className="size-4" />
              転送
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AiReplyButton({ onReply }: { onReply: (kind: ComposeKind, mode: ComposeAI) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div className="flex items-center overflow-hidden rounded-lg bg-accent shadow-sm">
        <button
          onClick={() => onReply("reply", "ai")}
          title="AIが返信の下書きを作成 (R)"
          className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          <Sparkles className="size-4" />
          AIで返信
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          title="その他のAI返信"
          className="grid h-full place-items-center border-l border-white/25 px-1.5 text-accent-fg transition-opacity hover:opacity-90"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow)]">
            <button
              onClick={() => {
                setOpen(false);
                onReply("replyAll", "ai");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <ReplyAll className="size-4" />
              AIで全員に返信
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onReply("forward", "ai");
              }}
              title="AIが要点まとめ付きの転送文を下書き"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <Forward className="size-4" />
              AIで転送
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ImportanceBar({
  email,
  classifying,
  onFeedback,
}: {
  email: Email;
  classifying: boolean;
  onFeedback: (i: Importance) => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5">
      <Sparkles className="size-3.5 text-accent" />
      {classifying ? (
        <span className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Loader2 className="size-3 animate-spin" /> 重要度を判定中…
        </span>
      ) : email.importance ? (
        <>
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
              email.importance === "high"
                ? "bg-high-soft text-high"
                : email.importance === "low"
                  ? "bg-surface-2 text-low"
                  : "bg-accent-soft text-accent",
            )}
          >
            {IMPORTANCE_LABEL[email.importance]}
          </span>
          {email.importanceReason && (
            <span className="text-xs text-fg-muted">{email.importanceReason}</span>
          )}
        </>
      ) : (
        <span className="text-xs text-fg-subtle">重要度は未判定</span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <span className="mr-1 text-[11px] text-fg-subtle">学習:</span>
        <FeedbackChip label="重要" onClick={() => onFeedback("high")} />
        <FeedbackChip label="通常" onClick={() => onFeedback("normal")} />
        <FeedbackChip label="低" onClick={() => onFeedback("low")} />
      </div>
    </div>
  );
}

function FeedbackChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-accent"
    >
      {label}
    </button>
  );
}

/** Thin separator between toolbar clusters. */
function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

/**
 * Quiet, icon-only toolbar button (label lives in the tooltip). Uniform size
 * keeps the action bar calm; `tone` carries the few colored states.
 */
function IconBtn({
  icon: Icon,
  title,
  onClick,
  active,
  tone,
  disabled,
}: {
  icon: typeof Archive;
  title: string;
  onClick: () => void;
  active?: boolean;
  tone?: "danger" | "star" | "ok";
  disabled?: boolean;
}) {
  const hover =
    tone === "danger"
      ? "hover:bg-high-soft hover:text-high"
      : tone === "star"
        ? "hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-400/10"
        : "hover:bg-surface-2 hover:text-fg";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-40",
        hover,
        active && tone !== "star" ? "bg-surface-2 text-fg" : "text-fg-muted",
      )}
    >
      <Icon
        className={cn(
          "size-4",
          tone === "star" && active && "fill-amber-400 text-amber-400",
          tone === "ok" && "text-emerald-600",
        )}
      />
    </button>
  );
}
