"use client";

import { useState } from "react";
import {
  ListTodo,
  ArrowUpRight,
  Trash2,
  AlarmClock,
  FolderKanban,
  ScrollText,
  CalendarPlus,
  CalendarCheck,
  RefreshCw,
  Send,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TodoItem, OpWorkPackage, DevlogIssue } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/** ISO → <input type="datetime-local"> value (local time, no seconds). */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dueState(due?: string): "overdue" | "soon" | "later" | "none" {
  if (!due) return "none";
  const ms = new Date(due).getTime() - Date.now();
  if (Number.isNaN(ms)) return "none";
  if (ms < 0) return "overdue";
  if (ms < 24 * 60 * 60 * 1000) return "soon";
  return "later";
}

/** Open first, sorted by due (overdue→soon→later→no-due); done last. */
function sortTodos(todos: TodoItem[]): TodoItem[] {
  const rank = (t: TodoItem) => {
    if (t.done) return 4;
    const s = dueState(t.due);
    return s === "overdue" ? 0 : s === "soon" ? 1 : s === "later" ? 2 : 3;
  };
  return [...todos].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    // Within a group: earliest due first; no-due keeps newest-first.
    if (a.due && b.due) return +new Date(a.due) - +new Date(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return +new Date(b.createdAt) - +new Date(a.createdAt);
  });
}

/**
 * TODO（「あとで」）ビュー: メールから印を付けたタスクを期限順に一覧。埋もれない。
 * 期限は各行で編集、チェックで完了、クリックで元メールへ。local-first。
 */
export function TodoView({
  todos,
  onOpenEmail,
  onSetDue,
  onToggleDone,
  onRemove,
  issueTargets,
  openProjectTasks,
  openProjectLoading,
  onRefreshOpenProject,
  devlogTasks,
  devlogLoading,
  onRefreshDevlog,
  calendarTargets,
}: {
  todos: TodoItem[];
  onOpenEmail: (id: string) => void;
  onSetDue: (id: string, due: string | null) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onRemove: (id: string) => void;
  /** 起票（work package / issue 作成）連携の宛先（OpenProject / devlog 等・設定済みのみ）。
   *  1件なら直接起票、複数なら小メニューで宛先選択。紐付け済みは isLinked で色分け。
   *  空なら起票ボタンを出さない。 */
  issueTargets?: {
    id: string;
    label: string;
    icon?: LucideIcon;
    onSend: (todo: TodoItem) => void;
    isLinked: (todo: TodoItem) => boolean;
  }[];
  /** OpenProject から pull した自分の未完了タスク（読み取り専用・連携有効時のみ）。 */
  openProjectTasks?: OpWorkPackage[];
  openProjectLoading?: boolean;
  onRefreshOpenProject?: () => void;
  /** devlog から pull した未完了 issue（読み取り専用・連携有効時のみ）。 */
  devlogTasks?: DevlogIssue[];
  devlogLoading?: boolean;
  onRefreshDevlog?: () => void;
  /** カレンダー連携の宛先（Nextcloud / Google 等・設定済みのみ）。期限ありのTODOで
   *  1件なら直接登録、複数なら小メニュー。空なら追加ボタンを出さない。 */
  calendarTargets?: {
    id: string;
    label: string;
    onAdd: (todo: TodoItem) => void;
    isAdded: (todo: TodoItem) => boolean;
  }[];
}) {
  const { t } = useI18n();
  const ordered = sortTodos(todos);
  const openCount = todos.filter((x) => !x.done).length;
  // Which row's calendar picker is open (only when 2+ calendar targets exist).
  const [calMenuFor, setCalMenuFor] = useState<string | null>(null);
  const cals = calendarTargets ?? [];
  // Which row's 起票 picker is open (only when 2+ issue targets exist).
  const [issueMenuFor, setIssueMenuFor] = useState<string | null>(null);
  const issues = issueTargets ?? [];

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-bg">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-6 py-3.5">
        <ListTodo className="size-4 text-accent" />
        <h1 className="text-sm font-semibold">{t("nav.todo")}</h1>
        <span className="text-xs text-fg-subtle">
          {t("todo.openCount").replace("{n}", String(openCount))}
        </span>
      </header>
      <p className="border-b border-border bg-surface-2 px-6 py-2 text-[11px] text-fg-muted">
        {t("todo.intro")}
      </p>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl">
          {ordered.length === 0 ? (
            <div className="grid place-items-center gap-2 py-16 text-center text-sm text-fg-subtle">
              <ListTodo className="size-8 opacity-40" />
              <p>{t("todo.empty")}</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {ordered.map((todo) => {
                const s = dueState(todo.due);
                return (
                  <li
                    key={todo.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5",
                      todo.done && "opacity-55",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={!!todo.done}
                      onChange={(e) => onToggleDone(todo.id, e.target.checked)}
                      title={t("todo.done")}
                      className="size-4 shrink-0 accent-[var(--accent,#6d5ae6)]"
                    />
                    <button
                      onClick={() => onOpenEmail(todo.id)}
                      className="flex min-w-0 flex-1 flex-col items-start text-left"
                    >
                      <span
                        className={cn(
                          "flex w-full items-center gap-1.5 truncate text-sm font-medium",
                          todo.done && "line-through",
                        )}
                      >
                        <span className="truncate">
                          {todo.subject || t("drafts.noSubject")}
                        </span>
                        <ArrowUpRight className="size-3 shrink-0 text-fg-subtle" />
                      </span>
                      <span className="truncate text-xs text-fg-subtle">
                        {todo.fromName || todo.fromEmail || ""}
                      </span>
                    </button>
                    {/* 期限（任意）: 空欄可。overdue=赤 / soon=琥珀。 */}
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px]",
                        s === "overdue"
                          ? "border-high/40 bg-high-soft text-high"
                          : s === "soon"
                            ? "border-amber-400/50 bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
                            : "border-border text-fg-muted",
                      )}
                      title={t("todo.due")}
                    >
                      <AlarmClock className="size-3 shrink-0" />
                      <input
                        type="datetime-local"
                        value={toLocalInput(todo.due)}
                        onChange={(e) =>
                          onSetDue(
                            todo.id,
                            e.target.value
                              ? new Date(e.target.value).toISOString()
                              : null,
                          )
                        }
                        className="bg-transparent text-[11px] outline-none"
                      />
                    </span>
                    {cals.length > 0 && todo.due && (
                      <div className="relative shrink-0">
                        <button
                          onClick={() => {
                            if (cals.length === 1) cals[0].onAdd(todo);
                            else
                              setCalMenuFor((v) =>
                                v === todo.id ? null : todo.id,
                              );
                          }}
                          title={t("nc.addTodo")}
                          className={cn(
                            "grid size-7 place-items-center rounded-md transition-colors hover:bg-surface-2",
                            cals.some((c) => c.isAdded(todo))
                              ? "text-accent"
                              : "text-fg-subtle hover:text-accent",
                          )}
                        >
                          {cals.some((c) => c.isAdded(todo)) ? (
                            <CalendarCheck className="size-3.5" />
                          ) : (
                            <CalendarPlus className="size-3.5" />
                          )}
                        </button>
                        {calMenuFor === todo.id && cals.length > 1 && (
                          <>
                            <button
                              aria-hidden
                              onClick={() => setCalMenuFor(null)}
                              className="fixed inset-0 z-40 cursor-default"
                            />
                            <div className="absolute right-0 top-8 z-50 flex min-w-40 flex-col overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-[var(--shadow)]">
                              {cals.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => {
                                    setCalMenuFor(null);
                                    c.onAdd(todo);
                                  }}
                                  className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-surface-2"
                                >
                                  {c.isAdded(todo) ? (
                                    <CalendarCheck className="size-3.5 text-accent" />
                                  ) : (
                                    <CalendarPlus className="size-3.5" />
                                  )}
                                  {c.label}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {issues.length > 0 &&
                      (() => {
                        // 1件=直接起票 / 複数=小メニューで宛先選択（カレンダーと同じ作法）。
                        const single = issues.length === 1 ? issues[0] : null;
                        const linked = issues.some((i) => i.isLinked(todo));
                        // 単一連携は当該連携のアイコンを維持（見た目の互換）、複数は汎用アイコン。
                        const SingleIcon = single?.icon ?? Send;
                        return (
                          <div className="relative shrink-0">
                            <button
                              onClick={() => {
                                if (single) single.onSend(todo);
                                else
                                  setIssueMenuFor((v) =>
                                    v === todo.id ? null : todo.id,
                                  );
                              }}
                              title={single ? single.label : t("issue.send")}
                              className={cn(
                                "grid size-7 place-items-center rounded-md transition-colors hover:bg-surface-2",
                                linked
                                  ? "text-accent"
                                  : "text-fg-subtle hover:text-accent",
                              )}
                            >
                              {single ? (
                                <SingleIcon className="size-3.5" />
                              ) : (
                                <Send className="size-3.5" />
                              )}
                            </button>
                            {issueMenuFor === todo.id && issues.length > 1 && (
                              <>
                                <button
                                  aria-hidden
                                  onClick={() => setIssueMenuFor(null)}
                                  className="fixed inset-0 z-40 cursor-default"
                                />
                                <div className="absolute right-0 top-8 z-50 flex min-w-40 flex-col overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-[var(--shadow)]">
                                  {issues.map((i) => {
                                    const Icon = i.icon ?? Send;
                                    return (
                                      <button
                                        key={i.id}
                                        onClick={() => {
                                          setIssueMenuFor(null);
                                          i.onSend(todo);
                                        }}
                                        className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-surface-2"
                                      >
                                        <Icon
                                          className={cn(
                                            "size-3.5",
                                            i.isLinked(todo) && "text-accent",
                                          )}
                                        />
                                        {i.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()}
                    <button
                      onClick={() => onRemove(todo.id)}
                      title={t("todo.remove")}
                      className="grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-high"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* OpenProject pull（読み取り専用）: 自分の未完了タスクを一覧。クリックで
              ブラウザで開く。書き込み/同期はしない。連携有効時のみ表示。 */}
          {onRefreshOpenProject && (
            <section className="mt-6">
              <div className="mb-2 flex items-center gap-2">
                <FolderKanban className="size-4 text-accent" />
                <h2 className="text-xs font-semibold">{t("op.pull.title")}</h2>
                <button
                  onClick={onRefreshOpenProject}
                  title={t("op.pull.refresh")}
                  className="grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
                >
                  <RefreshCw
                    className={cn(
                      "size-3.5",
                      openProjectLoading && "animate-spin",
                    )}
                  />
                </button>
              </div>
              {(openProjectTasks?.length ?? 0) === 0 ? (
                <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-fg-subtle">
                  {openProjectLoading
                    ? t("op.pull.loading")
                    : t("op.pull.empty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {openProjectTasks!.map((wp) => (
                    <li key={wp.id}>
                      <a
                        href={wp.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 hover:border-accent"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                            <span className="truncate">{wp.subject}</span>
                            <ArrowUpRight className="size-3 shrink-0 text-fg-subtle" />
                          </span>
                          <span className="truncate text-xs text-fg-subtle">
                            #{wp.id}
                            {wp.type ? ` · ${wp.type}` : ""}
                            {wp.dueDate ? ` · ${wp.dueDate}` : ""}
                          </span>
                        </span>
                        {wp.status && (
                          <span className="shrink-0 rounded-md border border-border px-1.5 py-1 text-[11px] text-fg-muted">
                            {wp.status}
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* devlog pull（読み取り専用）: プロジェクトの未完了 issue を一覧。 */}
          {onRefreshDevlog && (
            <section className="mt-6">
              <div className="mb-2 flex items-center gap-2">
                <ScrollText className="size-4 text-accent" />
                <h2 className="text-xs font-semibold">{t("dv.pull.title")}</h2>
                <button
                  onClick={onRefreshDevlog}
                  title={t("dv.pull.refresh")}
                  className="grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
                >
                  <RefreshCw
                    className={cn("size-3.5", devlogLoading && "animate-spin")}
                  />
                </button>
              </div>
              {(devlogTasks?.length ?? 0) === 0 ? (
                <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-fg-subtle">
                  {devlogLoading ? t("dv.pull.loading") : t("dv.pull.empty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {devlogTasks!.map((iss) => (
                    <li key={iss.key}>
                      <a
                        href={iss.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 hover:border-accent"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                            <span className="truncate">{iss.title}</span>
                            <ArrowUpRight className="size-3 shrink-0 text-fg-subtle" />
                          </span>
                          <span className="truncate text-xs text-fg-subtle">
                            {iss.key}
                            {iss.priority ? ` · ${iss.priority}` : ""}
                            {iss.dueDate ? ` · ${iss.dueDate}` : ""}
                          </span>
                        </span>
                        {iss.status && (
                          <span className="shrink-0 rounded-md border border-border px-1.5 py-1 text-[11px] text-fg-muted">
                            {iss.status}
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
