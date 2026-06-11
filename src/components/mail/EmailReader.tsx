"use client";

import { Archive, Trash2, Mail, Sparkles, RotateCcw, Loader2, Reply } from "lucide-react";
import type { Email, Importance, MailboxState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, displayName, fullTime, initials } from "./helpers";

const IMPORTANCE_LABEL: Record<Importance, string> = {
  high: "重要",
  normal: "通常",
  low: "低",
};

export function EmailReader({
  email,
  folder,
  classifying,
  onArchive,
  onTrash,
  onRestore,
  onReply,
  onImportanceFeedback,
}: {
  email: Email | null;
  folder: MailboxState;
  classifying: boolean;
  onArchive: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onReply: (mode: "ai" | "plain") => void;
  onImportanceFeedback: (importance: Importance) => void;
}) {
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
        {folder !== "archived" && (
          <ActionButton icon={Archive} label="アーカイブ" onClick={onArchive} />
        )}
        {folder !== "trashed" ? (
          <ActionButton icon={Trash2} label="ゴミ箱" danger onClick={onTrash} />
        ) : (
          <ActionButton icon={RotateCcw} label="受信箱に戻す" onClick={onRestore} />
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => onReply("plain")}
            title="自分で書く返信 (Shift+R)"
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Reply className="size-4" />
            返信
          </button>
          <button
            onClick={() => onReply("ai")}
            title="AIが下書きを作成 (R)"
            className="flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:scale-[1.02] active:scale-95"
          >
            <Sparkles className="size-4" />
            AIで返信
          </button>
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
            </div>
            <span className="ml-auto text-xs text-fg-subtle">{fullTime(email.date)}</span>
          </div>

          {/* AI importance */}
          <ImportanceBar
            email={email}
            classifying={classifying}
            onFeedback={onImportanceFeedback}
          />

          <article className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-fg/90">
            {email.body}
          </article>
        </div>
      </div>
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
