"use client";

import { useState } from "react";
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
} from "lucide-react";
import type { Email, FolderView, Importance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, displayName, fullTime, initials } from "./helpers";
import { ThreadView } from "./ThreadView";
import { LinkedText } from "./LinkedText";
import { HtmlMailView } from "./HtmlMailView";
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
}) {
  // Session-sticky preference: rich HTML (default) vs plain text.
  const [textMode, setTextMode] = useState(false);
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

  const name = displayName(email.from);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      {/* Action bar */}
      <div className="flex items-center gap-1 border-b border-border bg-surface px-5 py-2.5">
        <button
          onClick={onToggleStar}
          title={email.starred ? "スターを外す (S)" : "スターを付ける (S)"}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-400/10"
        >
          <Star className={cn("size-4", email.starred && "fill-amber-400 text-amber-400")} />
          <span className="hidden lg:inline">{email.starred ? "スター解除" : "スター"}</span>
        </button>
        {folder !== "archived" && folder !== "sent" && (
          <ActionButton icon={Archive} label="アーカイブ" onClick={onArchive} />
        )}
        {folder !== "trashed" ? (
          <ActionButton icon={Trash2} label="ゴミ箱" danger onClick={onTrash} />
        ) : (
          <ActionButton icon={RotateCcw} label="受信箱に戻す" onClick={onRestore} />
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => onReply("reply", "plain")}
            title="自分で書く返信 (Shift+R)"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Reply className="size-4" />
            返信
          </button>
          <button
            onClick={() => onReply("replyAll", "plain")}
            title="全員に返信 — 差出人＋To＋CCを引継ぎ (A)"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <ReplyAll className="size-4" />
            全員に返信
          </button>
          <button
            onClick={() => onReply("forward", "plain")}
            title="転送 (F)"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Forward className="size-4" />
            転送
          </button>
          <AiReplyButton onReply={onReply} />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-2xl animate-in">
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
                  title={email.to.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}
                >
                  宛先: {email.to.map((a) => a.name || a.email).join("、")}
                  {email.cc?.length ? `（CC: ${email.cc.map((a) => a.name || a.email).join("、")}）` : ""}
                </p>
              )}
            </div>
            <span className="ml-auto text-xs text-fg-subtle">{fullTime(email.date)}</span>
          </div>

          {/* AI importance */}
          <ImportanceBar
            email={email}
            classifying={classifying}
            onFeedback={onImportanceFeedback}
          />

          {thread && thread.length > 1 ? (
            <ThreadView messages={thread} selectedId={email.id} />
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
                <HtmlMailView html={email.html} />
              ) : (
                <article className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-fg/90">
                  <LinkedText text={email.body} />
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

function ActionButton({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Archive;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted transition-colors",
        danger ? "hover:bg-high-soft hover:text-high" : "hover:bg-surface-2 hover:text-fg",
      )}
    >
      <Icon className="size-4" />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
