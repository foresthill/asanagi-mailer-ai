"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Loader2, X, Ban } from "lucide-react";
import type { ScheduledSend, SendStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<SendStatus, string> = {
  scheduled: "送信予定",
  sent: "送信済み",
  failed: "失敗",
  canceled: "キャンセル",
};

const STATUS_STYLE: Record<SendStatus, string> = {
  scheduled: "bg-accent-soft text-accent",
  sent: "bg-emerald-500/15 text-emerald-600",
  failed: "bg-high-soft text-high",
  canceled: "bg-surface-2 text-fg-subtle",
};

function fmt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "メール送信予定" — list of scheduled sends with one-click cancel.
 * Canceling only flips the local schedule entry; nothing is sent.
 */
export function ScheduledPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ScheduledSend[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/schedule");
    const data = await res.json();
    setItems((data.items ?? []).slice().reverse()); // newest first
  }, []);

  useEffect(() => {
    // Refresh the list each time the panel opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  async function cancel(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/schedule?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
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
          <Clock className="size-4 text-accent" />
          <h2 className="text-sm font-semibold">メール送信予定</h2>
          <button
            onClick={onClose}
            className="ml-auto grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items === null ? (
            <div className="grid place-items-center py-12 text-fg-muted">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-fg-subtle">
              送信予定のメールはありません。「予約送信」から作成できます。
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                      STATUS_STYLE[s.status],
                    )}
                  >
                    {STATUS_LABEL[s.status]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.subject || "(件名なし)"}</p>
                    <p className="truncate text-xs text-fg-subtle">
                      宛先: {s.to.map((a) => a.email).join(", ")}
                      {s.account ? `・送信元: ${s.account}` : ""}
                      {s.error ? `・${s.error}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-fg-muted" title={s.sendAt}>
                    {fmt(s.sendAt)}
                  </span>
                  {s.status === "scheduled" && (
                    <button
                      onClick={() => cancel(s.id)}
                      disabled={busyId === s.id}
                      title="この予約をキャンセル"
                      className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-high hover:text-high disabled:opacity-50"
                    >
                      {busyId === s.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Ban className="size-3" />
                      )}
                      キャンセル
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
