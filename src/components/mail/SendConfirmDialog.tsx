"use client";

import { Send, X, AlertTriangle } from "lucide-react";

/**
 * Final pre-send check. Surfaces the from-address (mis-selected sender is easy
 * on multi-account setups) and warns about likely mistakes (empty subject, the
 * body says 添付 but nothing is attached) before the mail actually goes out.
 */
export function SendConfirmDialog({
  from,
  to,
  cc,
  bcc,
  subject,
  attachmentCount,
  warnings,
  sending,
  onConfirm,
  onClose,
}: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  attachmentCount: number;
  warnings: string[];
  sending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[440px] max-w-full animate-slide-up rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <Send className="size-4 text-accent" />
          <h3 className="text-sm font-semibold">送信の確認</h3>
          <button
            onClick={onClose}
            className="ml-auto grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        {warnings.length > 0 && (
          <div className="mb-3 space-y-1 rounded-lg border border-high/40 bg-high-soft px-3 py-2 text-xs text-high">
            {warnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {w}
              </p>
            ))}
          </div>
        )}

        <dl className="space-y-2 text-sm">
          <Row label="送信元" value={from} emphasize />
          <Row label="To" value={to || "（未設定）"} />
          {cc ? <Row label="Cc" value={cc} /> : null}
          {bcc ? <Row label="Bcc" value={bcc} /> : null}
          <Row label="件名" value={subject || "（空）"} />
          <Row label="添付" value={attachmentCount ? `${attachmentCount}件` : "なし"} />
        </dl>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3.5 py-2 text-sm text-fg-muted transition-colors hover:bg-surface-2"
          >
            戻る
          </button>
          <button
            onClick={onConfirm}
            disabled={sending}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            <Send className="size-4" />
            送信する
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-12 shrink-0 text-xs text-fg-subtle">{label}</dt>
      <dd className={`min-w-0 flex-1 break-words ${emphasize ? "font-medium text-fg" : "text-fg/90"}`}>
        {value}
      </dd>
    </div>
  );
}
