"use client";

import { Database } from "lucide-react";

export interface StorageInfo {
  fileBytes: number;
  totalMessages: number;
  perAccount: { account: string; count: number; bytes: number }[];
  retentionPerAccount: number;
}

/** Visual scale for the bar — local text cache stays far below this. */
const BAR_CAP_BYTES = 200 * 1024 * 1024; // 200 MB

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Gmail-style always-visible storage meter for the local SQLite cache.
 * Hover shows the per-account breakdown.
 */
export function StorageMeter({ storage }: { storage: StorageInfo | null }) {
  if (!storage) return null;
  const pct = Math.min(100, (storage.fileBytes / BAR_CAP_BYTES) * 100);
  const breakdown = storage.perAccount
    .map((a) => `${a.account}: ${a.count.toLocaleString()}通 (${formatBytes(a.bytes)})`)
    .join("\n");
  const title = [
    `ローカルキャッシュ（テキストのみ・添付なし）`,
    breakdown || "(まだキャッシュなし)",
    `保持上限: 各アカウント直近${storage.retentionPerAccount.toLocaleString()}通`,
  ].join("\n");

  return (
    <div className="px-2 py-1.5" title={title}>
      <div className="flex items-center gap-1.5 text-[10px] text-fg-subtle">
        <Database className="size-3" />
        <span className="flex-1">ローカルキャッシュ</span>
        <span className="tabular-nums">
          {formatBytes(storage.fileBytes)}・{storage.totalMessages.toLocaleString()}通
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full bg-accent/60 transition-[width]"
          style={{ width: `${Math.max(pct, storage.fileBytes > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}
