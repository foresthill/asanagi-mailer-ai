"use client";

import { useState } from "react";
import { Download, DownloadCloud, Loader2, Paperclip } from "lucide-react";
import type { Attachment } from "@/lib/types";
import { getDownloadAsk, getDownloadDir } from "@/lib/download-prefs";

/** True inside the Tauri desktop app (where blob `<a download>` is a no-op). */
function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Emit an app-wide toast (MailApp listens for `asanagi:toast`). */
function toast(msg: string) {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("asanagi:toast", { detail: msg }));
}

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
  bare,
}: {
  emailId: string;
  attachments: Attachment[];
  /** Drop the outer card (margin/border/bg) — for use inside a popover. */
  bare?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  /** Save one attachment's bytes as a file. Bytes are fetched on demand (never
   *  cached locally). Browser: fetch+Blob anchor (embedded-app safe). Desktop
   *  (Tauri): the WebView ignores blob `<a download>`, so hand the bytes to the
   *  native Save dialog instead. */
  /** Returns true if the file was saved, false if the user cancelled. */
  async function saveOne(att: Attachment): Promise<boolean> {
    const url = `/api/emails/${encodeURIComponent(emailId)}/attachment/${encodeURIComponent(att.id)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text().catch(() => "ダウンロードに失敗しました"));
    const blob = await res.blob();

    if (isDesktopApp()) {
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const { invoke } = await import("@tauri-apps/api/core");
      if (!getDownloadAsk()) {
        // Direct-save to the default folder (no dialog). Returns the saved path.
        await invoke<string>("save_file_to_dir", {
          dir: getDownloadDir(),
          filename: att.filename,
          bytes,
        });
        return true;
      }
      // Returns false if the user cancelled the Save dialog — not an error.
      return await invoke<boolean>("save_file_dialog", {
        filename: att.filename,
        bytes,
      });
    }

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = att.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
    return true;
  }

  async function download(att: Attachment) {
    setBusy(att.id);
    try {
      if (await saveOne(att)) toast(`「${att.filename}」を保存しました`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "ダウンロードに失敗しました");
    } finally {
      setBusy(null);
    }
  }

  /** Download every attachment in one action (each saved to the download folder).
   *  Sequential with a short gap so the browser doesn't drop rapid-fire saves. */
  async function downloadAll() {
    setBusy("*");
    const failed: string[] = [];
    let saved = 0;
    for (const att of attachments) {
      try {
        if (await saveOne(att)) saved++;
        await new Promise((r) => setTimeout(r, 250));
      } catch {
        failed.push(att.filename);
      }
    }
    setBusy(null);
    if (saved > 0) toast(`${saved}件の添付を保存しました`);
    if (failed.length) alert(`一部の添付を取得できませんでした:\n${failed.join("\n")}`);
  }

  return (
    <div className={bare ? "" : "mt-5 rounded-xl border border-border bg-surface px-3.5 py-2.5"}>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <Paperclip className="size-3.5" />
          添付ファイル {attachments.length}件
        </p>
        {attachments.length > 1 ? (
          <button
            onClick={downloadAll}
            disabled={busy !== null}
            title="すべての添付をダウンロード"
            className="flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-0.5 text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {busy === "*" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <DownloadCloud className="size-3" />
            )}
            全てダウンロード
          </button>
        ) : null}
      </div>
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
