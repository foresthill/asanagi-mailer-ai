"use client";

import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import type { OutgoingAttachment } from "@/lib/types";
import { formatBytes } from "./StorageMeter";

/** Read a browser File into an OutgoingAttachment (base64, no data: prefix). */
export function fileToOutgoingAttachment(file: File): Promise<OutgoingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("ファイルの読み込みに失敗しました"));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        content: comma >= 0 ? result.slice(comma + 1) : "",
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

/** Compact "添付" button (+ hidden file input) for the composer action bar. */
export function AttachmentButton({
  onAdd,
  disabled,
}: {
  onAdd: (files: FileList | File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title="ファイルを添付（本文へドラッグ&ドロップも可）"
        className="grid size-9 shrink-0 place-items-center rounded-lg border border-border text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        <Paperclip className="size-4" />
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onAdd(e.target.files);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />
    </>
  );
}

/** Chips for the currently-attached files (rendered only when there are any). */
export function AttachmentChips({
  items,
  onRemove,
  disabled,
}: {
  items: OutgoingAttachment[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((a, i) => (
        <span
          key={`${a.filename}-${i}`}
          className="flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs"
        >
          <Paperclip className="size-3 shrink-0 text-fg-subtle" />
          <span className="min-w-0 truncate">{a.filename}</span>
          <span className="shrink-0 text-fg-subtle">{formatBytes(a.size)}</span>
          <button
            type="button"
            onClick={() => onRemove(i)}
            disabled={disabled}
            title="この添付を外す"
            className="shrink-0 rounded text-fg-subtle hover:text-high disabled:opacity-50"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
    </div>
  );
}
