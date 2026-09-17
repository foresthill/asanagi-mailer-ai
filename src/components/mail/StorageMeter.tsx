"use client";

import { Database } from "lucide-react";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
  if (!storage) return null;
  const pct = Math.min(100, (storage.fileBytes / BAR_CAP_BYTES) * 100);
  const msg = t("storage.msgSuffix");
  const breakdown = storage.perAccount
    .map((a) => `${a.account}: ${a.count.toLocaleString()}${msg} (${formatBytes(a.bytes)})`)
    .join("\n");
  const title = [
    t("storage.tooltip.title"),
    breakdown || t("storage.tooltip.empty"),
    t("storage.tooltip.retention").replace("{n}", storage.retentionPerAccount.toLocaleString()),
  ].join("\n");

  return (
    <div className="px-2 py-1.5" title={title}>
      <div className="flex items-center gap-1.5 text-[10px] text-fg-subtle">
        <Database className="size-3" />
        <span className="flex-1">{t("storage.label")}</span>
        <span className="tabular-nums">
          {formatBytes(storage.fileBytes)}・{storage.totalMessages.toLocaleString()}
          {msg}
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
