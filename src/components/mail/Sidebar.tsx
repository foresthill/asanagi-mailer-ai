"use client";

import {
  Archive,
  Inbox,
  Send,
  Star,
  Trash2,
  Sparkles,
  Clock,
  Settings,
  Layers,
  AtSign,
  SquarePen,
  Users,
  ListChecks,
} from "lucide-react";
import type { FolderView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StorageMeter, type StorageInfo } from "./StorageMeter";
import type { AccountInfo } from "@/lib/email/accounts";

const FOLDERS: { key: FolderView; label: string; icon: typeof Inbox }[] = [
  { key: "inbox", label: "受信箱", icon: Inbox },
  { key: "starred", label: "スター付き", icon: Star },
  { key: "sent", label: "送信箱", icon: Send },
  { key: "archived", label: "アーカイブ", icon: Archive },
  { key: "trashed", label: "ゴミ箱", icon: Trash2 },
];

export function Sidebar({
  folder,
  counts,
  scheduledCount,
  aiConfigured,
  accounts,
  account,
  storage,
  view,
  onSelect,
  onSelectAccount,
  onOpenSettings,
  onOpenScheduled,
  onCompose,
  onSelectView,
}: {
  folder: FolderView;
  counts: Partial<Record<FolderView, number>>;
  scheduledCount: number;
  aiConfigured: boolean;
  accounts: AccountInfo[];
  account: string; // "all" or an account key
  storage: StorageInfo | null;
  view: "mail" | "contacts" | "triage";
  onSelect: (f: FolderView) => void;
  onSelectView: (v: "mail" | "contacts" | "triage") => void;
  onSelectAccount: (key: string) => void;
  onOpenSettings: () => void;
  onOpenScheduled: () => void;
  onCompose: () => void;
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

      <button
        onClick={onCompose}
        title="新規メールを作成 (C)"
        className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:scale-[1.01] active:scale-95"
      >
        <SquarePen className="size-4" />
        作成
      </button>

      <nav className="flex flex-col gap-0.5">
        {FOLDERS.map(({ key, label, icon: Icon }) => {
          const active = view === "mail" && folder === key;
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
        <button
          onClick={() => onSelectView("contacts")}
          className={cn(
            "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
            view === "contacts"
              ? "bg-accent-soft font-medium text-fg"
              : "text-fg-muted hover:bg-surface hover:text-fg",
          )}
        >
          <Users className={cn("size-4", view === "contacts" && "text-accent")} />
          <span className="flex-1 text-left">連絡先</span>
        </button>
        <button
          onClick={() => onSelectView("triage")}
          title="AI判定の確認と是正（教師データ作り）"
          className={cn(
            "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
            view === "triage"
              ? "bg-accent-soft font-medium text-fg"
              : "text-fg-muted hover:bg-surface hover:text-fg",
          )}
        >
          <ListChecks className={cn("size-4", view === "triage" && "text-accent")} />
          <span className="flex-1 text-left">仕分けレビュー</span>
        </button>
      </nav>

      {/* Accounts: unified vs per-account view. Hidden when only one account. */}
      {accounts.length > 1 && (
        <div className="mt-2 border-t border-border pt-2">
          <p className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
            アカウント
          </p>
          <AccountButton
            icon={Layers}
            label="すべて（統合）"
            active={account === "all"}
            onClick={() => onSelectAccount("all")}
          />
          {accounts.map((a) => (
            <AccountButton
              key={a.key}
              icon={AtSign}
              label={a.address ?? a.label}
              active={account === a.key}
              onClick={() => onSelectAccount(a.key)}
            />
          ))}
        </div>
      )}

      <div className="mt-2 border-t border-border pt-2">
        <button
          onClick={onOpenScheduled}
          title="メール送信予定を表示"
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <Clock className="size-4" />
          <span className="flex-1 text-left">予約送信</span>
          {scheduledCount ? (
            <span className="rounded-full bg-accent-soft px-1.5 text-xs tabular-nums text-accent">
              {scheduledCount}
            </span>
          ) : null}
        </button>
      </div>

      <div className="mt-auto flex flex-col gap-1">
        <StorageMeter storage={storage} />
        <div className="px-2">
          <button
            onClick={onOpenSettings}
            title="AI 接続設定"
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors",
              aiConfigured
                ? "text-fg-subtle hover:bg-surface hover:text-fg"
                : "bg-high-soft text-high hover:opacity-90",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                aiConfigured ? "bg-emerald-500" : "bg-high",
              )}
            />
            <span className="flex-1 text-left">
              {aiConfigured ? "AI 接続済み" : "AIキー未設定（簡易モード）"}
            </span>
            <Settings className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function AccountButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Layers;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
        active ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-surface hover:text-fg",
      )}
    >
      <Icon className={cn("size-3.5", active && "text-accent")} />
      <span className="flex-1 truncate text-left">{label}</span>
    </button>
  );
}
