"use client";

import {
  Archive,
  Trash2,
  Loader2,
  Inbox,
  Layers,
  RefreshCw,
  Reply,
  Search,
  Star,
  X,
} from "lucide-react";
import type { FolderView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, initials, relativeTime } from "./helpers";
import type { ThreadRow } from "./threadList";

const FOLDER_LABEL: Record<FolderView, string> = {
  inbox: "受信箱",
  starred: "スター付き",
  sent: "送信箱",
  archived: "アーカイブ",
  trashed: "ゴミ箱",
};

export function EmailList({
  folder,
  rows,
  loading,
  selectedId,
  searchQuery,
  searching,
  grouping,
  accountLabels,
  onSearchChange,
  onToggleGrouping,
  onSelect,
  onArchive,
  onTrash,
  onToggleStar,
  onRefresh,
}: {
  folder: FolderView;
  /** Conversation rows (1 row = 1 conversation when grouping is on). */
  rows: ThreadRow[];
  loading: boolean;
  selectedId: string | null;
  /** Current search box value; non-empty switches the list to results. */
  searchQuery: string;
  /** True while the list shows search results instead of the folder. */
  searching: boolean;
  /** スレッド表示（1会話=1行）が有効か。検索結果では常に個別表示。 */
  grouping: boolean;
  /** account key → short label; non-null shows the origin badge per row
   *  (unified inbox / search across multiple accounts). */
  accountLabels: Record<string, string> | null;
  onSearchChange: (q: string) => void;
  onToggleGrouping: () => void;
  onSelect: (id: string) => void;
  /** Thread-unit: every id of the row (1 element when not grouped). */
  onArchive: (ids: string[]) => void;
  onTrash: (ids: string[]) => void;
  onToggleStar: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex w-[384px] shrink-0 flex-col border-r border-border bg-surface">
      <header className="flex items-center gap-2 px-5 pb-2 pt-5">
        <h1 className="text-base font-semibold tracking-tight">
          {searching ? "検索結果" : FOLDER_LABEL[folder]}
        </h1>
        {!searching && (
          <>
            <button
              onClick={onRefresh}
              disabled={loading}
              title="更新"
              className="grid size-6 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </button>
            <button
              onClick={onToggleGrouping}
              title={
                grouping
                  ? "スレッド表示中（1会話=1行）— クリックで個別表示"
                  : "個別表示中 — クリックでスレッド表示（1会話=1行）"
              }
              className={cn(
                "grid size-6 place-items-center rounded-md transition-colors hover:bg-surface-2",
                grouping ? "text-accent" : "text-fg-subtle hover:text-fg",
              )}
            >
              <Layers className="size-3.5" />
            </button>
          </>
        )}
        <span className="ml-auto text-xs text-fg-subtle">{rows.length}件</span>
      </header>

      {/* Search across the local cache (all accounts & folders). */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 focus-within:border-accent">
          <Search className="size-3.5 shrink-0 text-fg-subtle" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="検索（件名・本文・差出人）"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              title="検索をクリア"
              className="grid size-5 shrink-0 place-items-center rounded text-fg-subtle hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="grid h-40 place-items-center text-fg-subtle">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="grid h-60 place-items-center px-6 text-center">
            <div className="flex flex-col items-center gap-2 text-fg-subtle">
              <Inbox className="size-8 opacity-50" />
              <p className="text-sm">
                {searching
                  ? "該当するメールがありません（ローカルキャッシュ内を検索）"
                  : folder === "inbox"
                    ? "受信箱はすべて片付きました 🎉"
                    : "ここには何もありません"}
              </p>
            </div>
          </div>
        ) : (
          rows.map((row) => (
            <EmailListItem
              key={row.email.id}
              row={row}
              active={row.email.id === selectedId}
              folder={folder}
              accountLabel={
                accountLabels && row.email.account
                  ? (accountLabels[row.email.account] ?? row.email.account)
                  : null
              }
              onSelect={() => onSelect(row.email.id)}
              onArchive={() => onArchive(row.ids)}
              onTrash={() => onTrash(row.ids)}
              onToggleStar={() => onToggleStar(row.email.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmailListItem({
  row,
  active,
  folder,
  accountLabel,
  onSelect,
  onArchive,
  onTrash,
  onToggleStar,
}: {
  row: ThreadRow;
  active: boolean;
  folder: FolderView;
  /** Origin account badge text (unified inbox only); null hides it. */
  accountLabel: string | null;
  onSelect: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onToggleStar: () => void;
}) {
  const { email, count, participants, unread, starred } = row;
  const threadActionHint = count > 1 ? `（会話${count}通すべて）` : "";
  // Sent mail: the avatar represents the recipient (the row shows "To: …").
  const face = email.state === "sent" && email.to[0] ? email.to[0] : email.from;
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
          style={{ background: avatarColor(participants) }}
        >
          {initials(face)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {unread && <span className="size-2 shrink-0 rounded-full bg-accent" />}
            <span
              className={cn(
                "truncate text-sm",
                unread ? "font-semibold text-fg" : "font-normal text-fg-muted",
              )}
            >
              {participants}
            </span>
            {count > 1 && (
              <span
                title={`この会話のメール ${count}通を1行に集約しています`}
                className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold tabular-nums text-fg-muted"
              >
                {count}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-fg-subtle">
              {starred && (
                <Star className="size-3 fill-amber-400 text-amber-400" aria-label="スター付き" />
              )}
              {email.replied && (
                <Reply className="size-3 text-accent" aria-label="返信済み" />
              )}
              {relativeTime(email.date)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {email.importance === "high" && (
              <span
                title="簡易判定: 重要（学習シグナル/キーワード。開くとAIが精密判定）"
                className="shrink-0 rounded bg-high-soft px-1 text-[10px] font-semibold text-high"
              >
                重要
              </span>
            )}
            {email.importance === "low" && (
              <span
                title="簡易判定: 低（ニュースレター等。開くとAIが精密判定）"
                className="shrink-0 rounded bg-surface-2 px-1 text-[10px] text-fg-subtle"
              >
                低
              </span>
            )}
            <p
              className={cn(
                "truncate text-sm",
                unread ? "font-medium text-fg" : "text-fg-muted",
              )}
            >
              {email.subject}
            </p>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-fg-subtle">{email.snippet}</p>
            {accountLabel && (
              <span
                className="flex max-w-[40%] shrink-0 items-center gap-1 rounded-full border border-border bg-surface-2 px-1.5 py-px text-[10px] text-fg-muted"
                title={`アカウント: ${accountLabel}`}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: avatarColor(email.account ?? "") }}
                />
                <span className="truncate">{accountLabel}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Hover quick-actions */}
      <div className="absolute right-2 top-2 hidden items-center gap-1 rounded-lg bg-surface/90 p-0.5 shadow-sm backdrop-blur group-hover:flex">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar();
          }}
          title={email.starred ? "スターを外す (S)" : "スターを付ける (S)"}
          className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-400/10"
        >
          <Star className={cn("size-4", email.starred && "fill-amber-400 text-amber-400")} />
        </button>
        {folder !== "archived" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            title={`アーカイブ${threadActionHint} (E)`}
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
            title={`ゴミ箱へ${threadActionHint}`}
            className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-high-soft hover:text-high"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
