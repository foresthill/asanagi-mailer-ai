"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Loader2, X, Ban, ChevronRight } from "lucide-react";
import type { ScheduledSend, SendStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<SendStatus, string> = {
  scheduled: "送信予定",
  sending: "送信中",
  sent: "送信済み",
  failed: "失敗",
  canceled: "キャンセル",
};

const STATUS_STYLE: Record<SendStatus, string> = {
  scheduled: "bg-accent-soft text-accent",
  sending: "bg-amber-500/15 text-amber-600",
  sent: "bg-emerald-500/15 text-emerald-600",
  failed: "bg-high-soft text-high",
  canceled: "bg-surface-2 text-fg-subtle",
};

function fmt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtFull(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addrList(list?: { name?: string; email: string }[]): string {
  return (list ?? []).map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
}

/**
 * "メール送信予定" — list of scheduled sends with one-click cancel.
 * Canceling only flips the local schedule entry; nothing is sent.
 */
export function ScheduledPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ScheduledSend[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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

        <div className="min-h-0 flex-1 overflow-y-auto">
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
              {items.map((s) => {
                const expanded = openId === s.id;
                return (
                  <li key={s.id} className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                          STATUS_STYLE[s.status],
                        )}
                      >
                        {STATUS_LABEL[s.status]}
                      </span>
                      <button
                        onClick={() => setOpenId(expanded ? null : s.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        title="クリックで詳細（宛先・本文）を表示"
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 shrink-0 text-fg-subtle transition-transform",
                            expanded && "rotate-90",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {s.subject || "(件名なし)"}
                          </span>
                          <span className="block truncate text-xs text-fg-subtle">
                            宛先: {s.to.map((a) => a.email).join(", ")}
                            {s.account ? `・送信元: ${s.account}` : ""}
                            {s.error ? `・${s.error}` : ""}
                          </span>
                        </span>
                      </button>
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
                    </div>
                    {expanded && (
                      <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs">
                        <Detail label="送信予定">{fmtFull(s.sendAt)}</Detail>
                        <Detail label="送信元">{s.account ?? "（既定）"}</Detail>
                        <Detail label="To">{addrList(s.to) || "（未設定）"}</Detail>
                        {s.cc?.length ? <Detail label="Cc">{addrList(s.cc)}</Detail> : null}
                        {s.bcc?.length ? <Detail label="Bcc">{addrList(s.bcc)}</Detail> : null}
                        <Detail label="件名">{s.subject || "(件名なし)"}</Detail>
                        {s.error ? <Detail label="エラー">{s.error}</Detail> : null}
                        <div>
                          <p className="mb-1 font-medium text-fg-subtle">本文</p>
                          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-surface p-2.5 text-[13px] leading-6 text-fg/90">
                            {s.body || "（本文なし）"}
                          </pre>
                        </div>
                      </div>
                    )}
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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="flex gap-2">
      <span className="w-14 shrink-0 font-medium text-fg-subtle">{label}</span>
      <span className="min-w-0 flex-1 break-words text-fg/90">{children}</span>
    </p>
  );
}
