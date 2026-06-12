"use client";

import { useEffect, useState } from "react";
import { Archive, Check, Loader2, Sparkles, Trash2, X } from "lucide-react";
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

/**
 * 朝の一掃 — 受信箱を開いた直後に、差出人・件名・プレビューだけの
 * 安価な一括判定で「アーカイブ/ゴミ箱推奨」を提示し、チェックボックスで
 * 一気に片付ける（受信箱が澄む朝の儀式）。本文はAIに送らない。
 */
export function SweepDialog({
  emails,
  onApply,
  onClose,
}: {
  /** Current inbox emails (list payloads — no bodies needed). */
  emails: Email[];
  /** (archiveIds, trashIds) — applied thread-unaware (per mail). */
  onApply: (archiveIds: string[], trashIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SweepItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          // サーバの実エラー（クレジット上限等）をそのまま見せる — 対処可能な情報。
          throw new Error(data.error ? `判定に失敗しました: ${data.error}` : "判定に失敗しました");
        }
        if (!active) return;
        const list = (data.items ?? []) as SweepItem[];
        setItems(list);
        // 推奨されたものは最初から全部チェック（ガーっと片付ける前提）。
        setChecked(new Set(list.filter((i) => i.action !== "keep").map((i) => i.id)));
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

  const byId = new Map(emails.map((e) => [e.id, e]));
  const groups: { action: SweepAction; label: string; icon: typeof Archive; items: SweepItem[] }[] = [
    { action: "trash", label: "ゴミ箱推奨", icon: Trash2, items: items.filter((i) => i.action === "trash") },
    { action: "archive", label: "アーカイブ推奨", icon: Archive, items: items.filter((i) => i.action === "archive") },
  ];
  const keepCount = items.filter((i) => i.action === "keep").length;
  const checkedCount = checked.size;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function apply() {
    setApplying(true);
    try {
      const archiveIds = items
        .filter((i) => i.action === "archive" && checked.has(i.id))
        .map((i) => i.id);
      const trashIds = items
        .filter((i) => i.action === "trash" && checked.has(i.id))
        .map((i) => i.id);
      await onApply(archiveIds, trashIds);
      onClose();
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <div className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">
            <Sparkles className="size-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <h2 className="text-sm font-semibold">朝の一掃</h2>
            <span className="text-[11px] text-fg-subtle">
              差出人・件名・冒頭だけで安価に判定（本文はAIに送りません）
            </span>
          </div>
          <button
            onClick={onClose}
            className="ml-auto grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-12 text-fg-subtle">
              <Loader2 className="size-5 animate-spin text-accent" />
              <p className="text-sm">受信箱{emails.length}通を判定中…</p>
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-high">{error}</p>
          ) : groups.every((g) => g.items.length === 0) ? (
            <p className="py-10 text-center text-sm text-fg-subtle">
              片付け推奨はありません — 受信箱は澄んでいます 🎉
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map(
                (g) =>
                  g.items.length > 0 && (
                    <div key={g.action}>
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
                        <g.icon className="size-3.5" />
                        {g.label}（{g.items.length}件）
                      </p>
                      <div className="flex flex-col gap-0.5">
                        {g.items.map((i) => {
                          const mail = byId.get(i.id);
                          const on = checked.has(i.id);
                          return (
                            <button
                              key={i.id}
                              onClick={() => toggle(i.id)}
                              className={cn(
                                "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                                on ? "bg-accent-soft/60" : "hover:bg-surface-2",
                              )}
                            >
                              <span
                                className={cn(
                                  "grid size-4.5 shrink-0 place-items-center rounded border",
                                  on
                                    ? "border-accent bg-accent text-accent-fg"
                                    : "border-border bg-surface",
                                )}
                              >
                                {on && <Check className="size-3" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-2">
                                  <span className="truncate text-xs font-medium">
                                    {mail ? displayName(mail.from) : i.id}
                                  </span>
                                  <span className="truncate text-xs text-fg-muted">
                                    {mail?.subject}
                                  </span>
                                </span>
                              </span>
                              <span className="shrink-0 text-[10px] text-fg-subtle">{i.reason}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ),
              )}
              {keepCount > 0 && (
                <p className="text-[11px] text-fg-subtle">
                  ほか{keepCount}通は「人からのメール/要対応の可能性」のため対象外にしています。
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-surface-2"
          >
            今回はスキップ
          </button>
          <button
            onClick={apply}
            disabled={loading || applying || checkedCount === 0}
            className="ml-auto flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {applying ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            選択した{checkedCount}件を片付ける
          </button>
        </div>
      </div>
    </div>
  );
}
