"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, X, Trash2, Pencil } from "lucide-react";
import type { SavedDraft } from "@/lib/types";

function fmt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "下書き" — locally-saved unsent drafts. Click one to resume editing in the
 * composer; delete to discard. Local-first: drafts never leave the device.
 */
export function DraftsPanel({
  open,
  onClose,
  onOpenDraft,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onOpenDraft: (d: SavedDraft) => void;
  /** Drafts changed (e.g. deleted) → let the parent refresh its count badge. */
  onChanged: () => void;
}) {
  const [items, setItems] = useState<SavedDraft[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/drafts");
    const data = await res.json();
    setItems(data.drafts ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  async function remove(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <FileText className="size-4 text-accent" />
          <h2 className="text-sm font-semibold">下書き</h2>
          <button
            onClick={onClose}
            className="ml-auto grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {items === null ? (
            <div className="grid place-items-center py-12 text-fg-muted">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-fg-subtle">
              下書きはありません。作成画面の「下書き保存」で保存できます。
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <button
                    onClick={() => onOpenDraft(d)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title="この下書きを開いて続きを書く"
                  >
                    <Pencil className="size-3.5 shrink-0 text-fg-subtle" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.subject || "(件名なし)"}</p>
                      <p className="truncate text-xs text-fg-subtle">
                        宛先: {d.to.map((a) => a.name ?? a.email).join(", ") || "(未設定)"}
                        {d.body.trim() ? `・${d.body.trim().replace(/\s+/g, " ").slice(0, 40)}` : ""}
                      </p>
                    </div>
                  </button>
                  <span className="shrink-0 text-xs tabular-nums text-fg-muted" title={d.updatedAt}>
                    {fmt(d.updatedAt)}
                  </span>
                  <button
                    onClick={() => remove(d.id)}
                    disabled={busyId === d.id}
                    title="この下書きを削除"
                    className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-high hover:text-high disabled:opacity-50"
                  >
                    {busyId === d.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )}
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
