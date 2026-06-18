"use client";

import { useState } from "react";
import { Download, Loader2, Paperclip } from "lucide-react";
import type { Attachment } from "@/lib/types";

/** Human-readable file size. */
function fmtSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Attachment chips for the reader. Bytes are fetched on demand (never cached
 * locally) and saved via fetch+Blob — the embedded-app-safe download pattern
 * that avoids session loss.
 */
export function AttachmentList({
  emailId,
  attachments,
}: {
  emailId: string;
  attachments: Attachment[];
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function download(att: Attachment) {
    setBusy(att.id);
    try {
      const url = `/api/emails/${encodeURIComponent(emailId)}/attachment/${encodeURIComponent(att.id)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text().catch(() => "ダウンロードに失敗しました"));
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      alert(e instanceof Error ? e.message : "ダウンロードに失敗しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-border bg-surface px-3.5 py-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        <Paperclip className="size-3.5" />
        添付ファイル {attachments.length}件
      </p>
      <div className="flex flex-wrap gap-2">
        {attachments.map((att) => (
          <button
            key={att.id}
            onClick={() => download(att)}
            disabled={busy !== null}
            title={`${att.filename} をダウンロード`}
            className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 text-left text-xs transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {busy === att.id ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <Download className="size-4 shrink-0 text-fg-subtle" />
            )}
            <span className="min-w-0 truncate">{att.filename}</span>
            {att.size ? <span className="shrink-0 text-fg-subtle">{fmtSize(att.size)}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
