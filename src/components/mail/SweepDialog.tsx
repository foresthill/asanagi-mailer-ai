"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, Check, Inbox, Loader2, Sparkles, Trash2, X } from "lucide-react";
import type { Email } from "@/lib/types";
import { cn } from "@/lib/utils";
import { displayName } from "./helpers";

type SweepAction = "keep" | "archive" | "trash";

interface SweepItem {
  id: string;
  action: SweepAction;
  reason: string;
  source: "learned" | "heuristic" | "ai";
}

const ACTIONS: { value: SweepAction; label: string; icon: typeof Archive }[] = [
  { value: "keep", label: "残す", icon: Inbox },
  { value: "archive", label: "アーカイブ", icon: Archive },
  { value: "trash", label: "ゴミ箱", icon: Trash2 },
];

/**
 * 朝の一掃 — 受信箱を開いた直後に、差出人・件名・プレビューだけの
 * 安価な一括判定で処分を提案し、各メールごとに「残す/アーカイブ/ゴミ箱」を
 * その場で振り替えてから一括実行する（受信箱が澄む朝の儀式）。本文はAIに送らない。
 */
export function SweepDialog({
  emails,
  onApply,
  onClose,
}: {
  /** Current inbox emails (list payloads — no bodies needed). */
  emails: Email[];
  /** (archiveIds, trashIds) — applied per mail. */
  onApply: (archiveIds: string[], trashIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SweepItem[]>([]);
  /** AI推奨を初期値に、ユーザーが行ごとに上書きできる現在の処分。 */
  const [actions, setActions] = useState<Record<string, SweepAction>>({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** AI判定が使えずキーワード判定にフォールバックした場合の注意書き。 */
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/ai/sweep", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            // List payloads only — from/subject/snippet (no bodies).
            emails: emails.map((e) => ({
              id: e.id,
              from: e.from,
              subject: e.subject,
              snippet: e.snippet,
            })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error ? `判定に失敗しました: ${data.error}` : "判定に失敗しました");
        }
        if (!active) return;
        const list = (data.items ?? []) as SweepItem[];
        setItems(list);
        setActions(Object.fromEntries(list.map((i) => [i.id, i.action])));
        if (data.warning) setWarning(data.warning as string);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "判定に失敗しました");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byId = useMemo(() => new Map(emails.map((e) => [e.id, e])), [emails]);

  // 処分対象が先（ゴミ箱→アーカイブ→残す）に並ぶよう、AI推奨順を保ちつつ
  // 「残す」を末尾へ。各行のセレクタで自由に変えられる。
  const ordered = useMemo(() => {
    const rank: Record<SweepAction, number> = { trash: 0, archive: 1, keep: 2 };
    return [...items].sort((a, b) => rank[actions[a.id] ?? a.action] - rank[actions[b.id] ?? b.action]);
  }, [items, actions]);

  const archiveCount = items.filter((i) => actions[i.id] === "archive").length;
  const trashCount = items.filter((i) => actions[i.id] === "trash").length;
  const actionable = archiveCount + trashCount;

  /** 全行を一括で同じ処分に（ヘッダの一括ボタン）。 */
  const setAll = (action: SweepAction) =>
    setActions(Object.fromEntries(items.map((i) => [i.id, action])));

  /** 表示した全件（残す含む）を「判定済み」として記録 → 二度と出さない。
   *  確定・閉じる・×・背景クリックのどの閉じ方でも必ず通す。 */
  async function recordShown() {
    if (!items.length) return;
    try {
      await fetch("/api/sweep/reviewed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: items.map((i) => i.id) }),
      });
    } catch {
      /* 記録失敗は致命的でない */
    }
  }

  /** どんな閉じ方でも「判定済み」を記録してから閉じる。 */
  async function dismiss() {
    await recordShown();
    onClose();
  }

  /** 確定: アーカイブ/ゴミ箱を実行し、表示した全件を判定済みにして閉じる。 */
  async function apply() {
    setApplying(true);
    try {
      const archiveIds = items.filter((i) => actions[i.id] === "archive").map((i) => i.id);
      const trashIds = items.filter((i) => actions[i.id] === "trash").map((i) => i.id);
      await onApply(archiveIds, trashIds);
      await dismiss();
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={dismiss}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <div className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">
            <Sparkles className="size-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <h2 className="text-sm font-semibold">朝の一掃</h2>
            <span className="text-[11px] text-fg-subtle">
              AIの推奨を各行で変更できます（本文はAIに送りません）
            </span>
          </div>
          <button
            onClick={dismiss}
            className="ml-auto grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* min-h-0 is required: without it a flex child grows past the
            container and pushes the footer (確定) out of view. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-12 text-fg-subtle">
              <Loader2 className="size-5 animate-spin text-accent" />
              <p className="text-sm">受信箱{emails.length}通を判定中…</p>
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-high">{error}</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-subtle">
              受信箱は澄んでいます 🎉
            </p>
          ) : (
            <>
              {warning && (
                <p className="mb-2 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-300">
                  {warning}
                </p>
              )}
              {/* 一括変更（全部アーカイブ / 全部ゴミ箱 / 全部残す） */}
              <div className="mb-2 flex items-center gap-2 text-[11px] text-fg-subtle">
                <span>すべてを:</span>
                {ACTIONS.map((a) => (
                  <button
                    key={a.value}
                    onClick={() => setAll(a.value)}
                    className="rounded-md border border-border px-2 py-0.5 hover:border-accent hover:text-accent"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-0.5">
                {ordered.map((i) => {
                  const mail = byId.get(i.id);
                  const cur = actions[i.id] ?? i.action;
                  return (
                    <div
                      key={i.id}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5",
                        cur === "keep" ? "opacity-55" : "",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-xs font-medium">
                            {mail ? displayName(mail.from) : i.id}
                          </span>
                          <span className="truncate text-xs text-fg-muted">{mail?.subject}</span>
                        </span>
                        <span className="text-[10px] text-fg-subtle">{i.reason}</span>
                      </span>
                      {/* 3択セグメント: 残す / アーカイブ / ゴミ箱 */}
                      <span className="flex shrink-0 items-center overflow-hidden rounded-lg border border-border">
                        {ACTIONS.map((a) => {
                          const on = cur === a.value;
                          return (
                            <button
                              key={a.value}
                              onClick={() =>
                                setActions((prev) => ({ ...prev, [i.id]: a.value }))
                              }
                              title={a.label}
                              className={cn(
                                "flex items-center gap-1 px-2 py-1 text-[11px] transition-colors",
                                on
                                  ? a.value === "trash"
                                    ? "bg-high text-white"
                                    : a.value === "archive"
                                      ? "bg-accent text-accent-fg"
                                      : "bg-surface-2 text-fg"
                                  : "text-fg-subtle hover:bg-surface-2",
                              )}
                            >
                              <a.icon className="size-3" />
                              {on && <span>{a.label}</span>}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          <button
            onClick={dismiss}
            title="処分はせず閉じます。表示中のメールは判定済みとして次回は出ません"
            className="rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-surface-2"
          >
            閉じる
          </button>
          <span className="text-[11px] text-fg-subtle">
            アーカイブ{archiveCount}・ゴミ箱{trashCount}・残す{items.length - actionable}
          </span>
          <button
            onClick={apply}
            disabled={loading || applying || items.length === 0}
            title="この内容で確定（残したメールも含め、次回の一掃には出ません）"
            className="ml-auto flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {applying ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
