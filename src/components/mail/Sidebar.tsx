"use client";

import { Archive, Inbox, Trash2, Sparkles, Clock } from "lucide-react";
import type { MailboxState } from "@/lib/types";
import { cn } from "@/lib/utils";

const FOLDERS: { key: MailboxState; label: string; icon: typeof Inbox }[] = [
  { key: "inbox", label: "受信箱", icon: Inbox },
  { key: "archived", label: "アーカイブ", icon: Archive },
  { key: "trashed", label: "ゴミ箱", icon: Trash2 },
];

export function Sidebar({
  folder,
  counts,
  scheduledCount,
  aiConfigured,
  onSelect,
}: {
  folder: MailboxState;
  counts: Partial<Record<MailboxState, number>>;
  scheduledCount: number;
  aiConfigured: boolean;
  onSelect: (f: MailboxState) => void;
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface-2 px-3 py-4">
      <div className="mb-4 flex items-center gap-2 px-2">
        <div className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">
          <Sparkles className="size-4" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight">Asanagi</span>
          <span className="mt-0.5 text-[10px] text-fg-subtle">朝凪</span>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {FOLDERS.map(({ key, label, icon: Icon }) => {
          const active = folder === key;
          const count = counts[key];
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-accent-soft font-medium text-fg"
                  : "text-fg-muted hover:bg-surface hover:text-fg",
              )}
            >
              <Icon className={cn("size-4", active && "text-accent")} />
              <span className="flex-1 text-left">{label}</span>
              {count ? (
                <span className="text-xs tabular-nums text-fg-subtle">{count}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-2 border-t border-border pt-2">
        <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg-muted">
          <Clock className="size-4" />
          <span className="flex-1">予約送信</span>
          {scheduledCount ? (
            <span className="text-xs tabular-nums text-fg-subtle">{scheduledCount}</span>
          ) : null}
        </div>
      </div>

      <div className="mt-auto px-2">
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
            aiConfigured ? "text-fg-subtle" : "bg-high-soft text-high",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              aiConfigured ? "bg-emerald-500" : "bg-high",
            )}
          />
          {aiConfigured ? "AI 接続済み" : "AIキー未設定（簡易モード）"}
        </div>
      </div>
    </aside>
  );
}
