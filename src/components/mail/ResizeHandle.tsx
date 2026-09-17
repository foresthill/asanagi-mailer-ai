"use client";

import { useRef } from "react";

/**
 * A thin draggable vertical divider between two horizontal panes (e.g. the mail
 * list and the reader). Reports the horizontal drag delta in pixels; the parent
 * applies and persists the new width. Pointer capture keeps the drag smooth even
 * when the cursor moves faster than the handle.
 */
export function ResizeHandle({
  onResize,
  orientation = "vertical",
  title = orientation === "horizontal" ? "ドラッグで高さを変更" : "ドラッグで幅を変更",
}: {
  /** Drag delta along the resize axis (px): +x for vertical, +y for horizontal. */
  onResize: (delta: number) => void;
  /** "vertical" = a vertical bar resizing width (←→); "horizontal" = a horizontal
   *  bar resizing height (↑↓). */
  orientation?: "vertical" | "horizontal";
  title?: string;
}) {
  const last = useRef<number | null>(null);
  const horizontal = orientation === "horizontal";

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      title={title}
      onPointerDown={(e) => {
        last.current = horizontal ? e.clientY : e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const cur = horizontal ? e.clientY : e.clientX;
        const d = cur - last.current;
        if (d !== 0) {
          onResize(d);
          last.current = cur;
        }
      }}
      onPointerUp={(e) => {
        last.current = null;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* capture may already be gone */
        }
      }}
      className={
        horizontal
          ? "group relative z-10 -my-0.5 h-1.5 w-full shrink-0 cursor-row-resize touch-none select-none bg-transparent"
          : "group relative z-10 -mx-0.5 w-1.5 shrink-0 cursor-col-resize touch-none select-none bg-transparent"
      }
    >
      {/* Visible hairline that thickens/tints on hover & drag. */}
      <span
        className={
          horizontal
            ? "pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border transition-colors group-hover:h-0.5 group-hover:bg-accent group-active:bg-accent"
            : "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-accent group-active:bg-accent"
        }
      />
    </div>
  );
}
