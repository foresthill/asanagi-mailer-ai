"use client";

import { Archive, Trash2, Loader2, Inbox, RefreshCw, Reply } from "lucide-react";
import type { Email, MailboxState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, displayName, initials, relativeTime } from "./helpers";

const FOLDER_LABEL: Record<MailboxState, string> = {
  inbox: "受信箱",
  sent: "送信箱",
  archived: "アーカイブ",
  trashed: "ゴミ箱",
};

export function EmailList({
  folder,
  emails,
  loading,
  selectedId,
  onSelect,
  onArchive,
  onTrash,
  onRefresh,
}: {
  folder: MailboxState;
  emails: Email[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
  onTrash: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex w-[384px] shrink-0 flex-col border-r border-border bg-surface">
      <header className="flex items-center gap-2 px-5 pb-3 pt-5">
        <h1 className="text-base font-semibold tracking-tight">{FOLDER_LABEL[folder]}</h1>
        <button
          onClick={onRefresh}
          disabled={loading}
          title="更新"
          className="grid size-6 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
        <span className="ml-auto text-xs text-fg-subtle">{emails.length}件</span>
      </header>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="grid h-40 place-items-center text-fg-subtle">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : emails.length === 0 ? (
          <div className="grid h-60 place-items-center px-6 text-center">
            <div className="flex flex-col items-center gap-2 text-fg-subtle">
              <Inbox className="size-8 opacity-50" />
              <p className="text-sm">
                {folder === "inbox" ? "受信箱はすべて片付きました 🎉" : "ここには何もありません"}
              </p>
            </div>
          </div>
        ) : (
          emails.map((email) => (
            <EmailListItem
              key={email.id}
              email={email}
              active={email.id === selectedId}
              folder={folder}
              onSelect={() => onSelect(email.id)}
              onArchive={() => onArchive(email.id)}
              onTrash={() => onTrash(email.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmailListItem({
  email,
  active,
  folder,
  onSelect,
  onArchive,
  onTrash,
}: {
  email: Email;
  active: boolean;
  folder: MailboxState;
  onSelect: () => void;
  onArchive: () => void;
  onTrash: () => void;
}) {
  const name = displayName(email.from);
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative mb-0.5 cursor-pointer rounded-xl px-3 py-3 transition-colors",
        active ? "bg-accent-soft" : "hover:bg-surface-2",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
          style={{ background: avatarColor(name) }}
        >
          {initials(email.from)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {!email.read && <span className="size-2 shrink-0 rounded-full bg-accent" />}
            {email.importance === "high" && (
              <span className="size-2 shrink-0 rounded-full bg-high" title="重要" />
            )}
            <span
              className={cn(
                "truncate text-sm",
                email.read ? "font-normal text-fg-muted" : "font-semibold text-fg",
              )}
            >
              {name}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-fg-subtle">
              {email.replied && (
                <Reply className="size-3 text-accent" aria-label="返信済み" />
              )}
              {relativeTime(email.date)}
            </span>
          </div>
          <p
            className={cn(
              "mt-0.5 truncate text-sm",
              email.read ? "text-fg-muted" : "font-medium text-fg",
            )}
          >
            {email.subject}
          </p>
          <p className="mt-0.5 truncate text-xs text-fg-subtle">{email.snippet}</p>
        </div>
      </div>

      {/* Hover quick-actions */}
      <div className="absolute right-2 top-2 hidden items-center gap-1 rounded-lg bg-surface/90 p-0.5 shadow-sm backdrop-blur group-hover:flex">
        {folder !== "archived" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            title="アーカイブ (E)"
            className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-accent-soft hover:text-accent"
          >
            <Archive className="size-4" />
          </button>
        )}
        {folder !== "trashed" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTrash();
            }}
            title="ゴミ箱へ"
            className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-high-soft hover:text-high"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
