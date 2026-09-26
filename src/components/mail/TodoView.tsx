"use client";

import { ListTodo, ArrowUpRight, Trash2, AlarmClock } from "lucide-react";
import type { TodoItem } from "@/lib/types";
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
}: {
  todos: TodoItem[];
  onOpenEmail: (id: string) => void;
  onSetDue: (id: string, due: string | null) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  const ordered = sortTodos(todos);
  const openCount = todos.filter((x) => !x.done).length;

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
        </div>
      </div>
    </div>
  );
}
