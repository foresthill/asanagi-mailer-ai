"use client";

import { useState } from "react";
import {
  Archive,
  ChevronRight,
  Inbox,
  Sunrise,
  Send,
  Star,
  Trash2,
  Sparkles,
  Clock,
  Settings,
  PanelTop,
  PanelRight,
  Layers,
  AtSign,
  SquarePen,
  Users,
  ListChecks,
  ListTodo,
  FileText,
  ScrollText,
  FolderKanban,
} from "lucide-react";
import type { FolderView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StorageMeter, type StorageInfo } from "./StorageMeter";
import { ThemeToggle } from "./ThemeToggle";
import { ColorPreset } from "./ColorPreset";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useI18n } from "@/lib/i18n";
import type { AccountInfo } from "@/lib/email/accounts";

// label はロケール別に t(`folder.${key}`) で解決する。
const FOLDERS: { key: FolderView; icon: typeof Inbox }[] = [
  { key: "inbox", icon: Inbox },
  { key: "starred", icon: Star },
  { key: "sent", icon: Send },
  { key: "archived", icon: Archive },
  { key: "trashed", icon: Trash2 },
];

export function Sidebar({
  folder,
  counts,
  scheduledCount,
  draftsCount,
  todosCount,
  aiConfigured,
  accounts,
  account,
  storage,
  view,
  onSelect,
  onSelectAccountFolder,
  onOpenSettings,
  onOpenScheduled,
  onOpenDrafts,
  onOpenSweep,
  onCompose,
  onSelectView,
  layout,
  onSetLayout,
}: {
  folder: FolderView;
  counts: Partial<Record<FolderView, number>>;
  scheduledCount: number;
  draftsCount: number;
  /** 未完了 TODO 件数（サイドバーのバッジ）。 */
  todosCount: number;
  aiConfigured: boolean;
  accounts: AccountInfo[];
  account: string; // "all" or an account key
  storage: StorageInfo | null;
  view: "mail" | "contacts" | "triage" | "ailog" | "projects" | "todo";
  onSelect: (f: FolderView) => void;
  onSelectView: (
    v: "mail" | "contacts" | "triage" | "ailog" | "projects" | "todo",
  ) => void;
  /** Pick an account AND folder together (folders nested per account). */
  onSelectAccountFolder: (key: string, f: FolderView) => void;
  onOpenSettings: () => void;
  onOpenScheduled: () => void;
  onOpenDrafts: () => void;
  onOpenSweep: () => void;
  onCompose: () => void;
  /** 画面レイアウト: classic=左右(一覧|本文) / geek=上下(件名上・本文下)。 */
  layout: "classic" | "geek";
  onSetLayout: (l: "classic" | "geek") => void;
}) {
  const { t } = useI18n();
  // Account groups: "すべて（統合）" + each account. Folders hang under each.
  const groups = [
    { key: "all", label: t("account.all"), icon: Layers },
    ...accounts.map((a) => ({
      key: a.key,
      label: a.address ?? a.label,
      icon: AtSign,
    })),
  ];
  // Which account groups are expanded. Start with the active one (＋統合) open.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([account, "all"]),
  );
  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface-2 px-3 py-4">
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
        title={t("sidebar.compose.title")}
        className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:scale-[1.01] active:scale-95"
      >
        <SquarePen className="size-4" />
        {t("sidebar.compose")}
      </button>

      <nav className="flex flex-col gap-0.5">
        {accounts.length > 1
          ? // 複数アカウント: フォルダを各アカウント配下に入れ子（開閉トグル）
            groups.map((g) => {
              const open = expanded.has(g.key);
              const GroupIcon = g.icon;
              const activeGroup = view === "mail" && account === g.key;
              return (
                <div key={g.key}>
                  <button
                    onClick={() => toggleGroup(g.key)}
                    aria-expanded={open}
                    title={g.label}
                    className={cn(
                      "group flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors",
                      activeGroup
                        ? "text-fg"
                        : "text-fg-muted hover:bg-surface hover:text-fg",
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 text-fg-subtle transition-transform",
                        open && "rotate-90",
                      )}
                    />
                    <GroupIcon
                      className={cn(
                        "size-4 shrink-0",
                        activeGroup && "text-accent",
                      )}
                    />
                    <span className="flex-1 truncate text-left text-[13px]">
                      {g.label}
                    </span>
                  </button>
                  {open && (
                    <div className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-border pl-1.5">
                      {FOLDERS.map(({ key, icon: Icon }) => {
                        const active =
                          view === "mail" &&
                          account === g.key &&
                          folder === key;
                        // counts are only valid for the currently-loaded account.
                        const count =
                          account === g.key ? counts[key] : undefined;
                        return (
                          <button
                            key={key}
                            onClick={() => onSelectAccountFolder(g.key, key)}
                            className={cn(
                              "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                              active
                                ? "bg-accent-soft font-medium text-fg"
                                : "text-fg-muted hover:bg-surface hover:text-fg",
                            )}
                          >
                            <Icon
                              className={cn("size-4", active && "text-accent")}
                            />
                            <span className="flex-1 text-left">
                              {t(`folder.${key}`)}
                            </span>
                            {count ? (
                              <span className="text-xs tabular-nums text-fg-subtle">
                                {count}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          : // 単一アカウント: フォルダをそのまま並べる（従来どおり）
            FOLDERS.map(({ key, icon: Icon }) => {
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
                  <span className="flex-1 text-left">{t(`folder.${key}`)}</span>
                  {count ? (
                    <span className="text-xs tabular-nums text-fg-subtle">
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
        <div className="my-1 border-t border-border" />
        <button
          onClick={() => onSelectView("contacts")}
          className={cn(
            "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
            view === "contacts"
              ? "bg-accent-soft font-medium text-fg"
              : "text-fg-muted hover:bg-surface hover:text-fg",
          )}
        >
          <Users
            className={cn("size-4", view === "contacts" && "text-accent")}
          />
          <span className="flex-1 text-left">{t("nav.contacts")}</span>
        </button>
        <button
          onClick={() => onSelectView("projects")}
          title={t("nav.projects.title")}
          className={cn(
            "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
            view === "projects"
              ? "bg-accent-soft font-medium text-fg"
              : "text-fg-muted hover:bg-surface hover:text-fg",
          )}
        >
          <FolderKanban
            className={cn("size-4", view === "projects" && "text-accent")}
          />
          <span className="flex-1 text-left">{t("nav.projects")}</span>
        </button>
        <button
          onClick={() => onSelectView("todo")}
          title={t("nav.todo.title")}
          className={cn(
            "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
            view === "todo"
              ? "bg-accent-soft font-medium text-fg"
              : "text-fg-muted hover:bg-surface hover:text-fg",
          )}
        >
          <ListTodo
            className={cn("size-4", view === "todo" && "text-accent")}
          />
          <span className="flex-1 text-left">{t("nav.todo")}</span>
          {todosCount ? (
            <span className="rounded-full bg-accent-soft px-1.5 text-xs tabular-nums text-accent">
              {todosCount}
            </span>
          ) : null}
        </button>
        <button
          onClick={() => onSelectView("triage")}
          title={t("nav.triage.title")}
          className={cn(
            "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
            view === "triage"
              ? "bg-accent-soft font-medium text-fg"
              : "text-fg-muted hover:bg-surface hover:text-fg",
          )}
        >
          <ListChecks
            className={cn("size-4", view === "triage" && "text-accent")}
          />
          <span className="flex-1 text-left">{t("nav.triage")}</span>
        </button>
        <button
          onClick={() => onSelectView("ailog")}
          title={t("nav.ailog.title")}
          className={cn(
            "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
            view === "ailog"
              ? "bg-accent-soft font-medium text-fg"
              : "text-fg-muted hover:bg-surface hover:text-fg",
          )}
        >
          <ScrollText
            className={cn("size-4", view === "ailog" && "text-accent")}
          />
          <span className="flex-1 text-left">{t("nav.ailog")}</span>
        </button>
      </nav>

      <div className="mt-2 border-t border-border pt-2">
        <button
          onClick={onOpenSweep}
          title={t("nav.sweep.title")}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <Sunrise className="size-4" />
          <span className="flex-1 text-left">{t("nav.sweep")}</span>
        </button>
        <button
          onClick={onOpenDrafts}
          title={t("nav.drafts.title")}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <FileText className="size-4" />
          <span className="flex-1 text-left">{t("nav.drafts")}</span>
          {draftsCount ? (
            <span className="rounded-full bg-accent-soft px-1.5 text-xs tabular-nums text-accent">
              {draftsCount}
            </span>
          ) : null}
        </button>
        <button
          onClick={onOpenScheduled}
          title={t("nav.scheduled.title")}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <Clock className="size-4" />
          <span className="flex-1 text-left">{t("nav.scheduled")}</span>
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
            title={t("settings.title")}
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
              {aiConfigured
                ? t("settings.aiConnected")
                : t("settings.aiNotSet")}
            </span>
            <Settings className="size-3.5" />
          </button>
          {/* 表示切替: 左右(一覧|本文) / 上下(件名を上・本文を下) のセグメント。 */}
          <div className="mt-1 flex items-center gap-1.5 px-0.5 pt-1">
            <span className="shrink-0 text-[10px] text-fg-subtle">
              {t("view.label")}
            </span>
            <div className="flex flex-1 rounded-lg border border-border p-0.5">
              <button
                onClick={() => onSetLayout("classic")}
                aria-pressed={layout === "classic"}
                title={t("view.classic.title")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors",
                  layout === "classic"
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-fg-subtle hover:text-fg",
                )}
              >
                <PanelRight className="size-3" />
                {t("view.classic")}
              </button>
              <button
                onClick={() => onSetLayout("geek")}
                aria-pressed={layout === "geek"}
                title={t("view.geek.title")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors",
                  layout === "geek"
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-fg-subtle hover:text-fg",
                )}
              >
                <PanelTop className="size-3" />
                {t("view.geek")}
              </button>
            </div>
          </div>
          {/* テーマ切替: システム(OS追従) / ライト / ダーク。 */}
          <ThemeToggle />
          {/* テーマ色: アイリス(標準) / 朝凪(エメラルドブルー) / レトロ(セピア)。 */}
          <ColorPreset />
          {/* 言語切替: 社内展開向け（日/英/仏/中）。 */}
          <LanguageSwitcher />
        </div>
      </div>
    </aside>
  );
}
