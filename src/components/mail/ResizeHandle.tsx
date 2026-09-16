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
  title = "ドラッグで幅を変更",
}: {
  onResize: (deltaX: number) => void;
  title?: string;
}) {
  const lastX = useRef<number | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={title}
      onPointerDown={(e) => {
        lastX.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (lastX.current === null) return;
        const dx = e.clientX - lastX.current;
        if (dx !== 0) {
          onResize(dx);
          lastX.current = e.clientX;
        }
      }}
      onPointerUp={(e) => {
        lastX.current = null;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* capture may already be gone */
        }
      }}
      className="group relative z-10 -mx-0.5 w-1.5 shrink-0 cursor-col-resize touch-none select-none bg-transparent"
    >
      {/* Visible hairline that thickens/tints on hover & drag. */}
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-accent group-active:bg-accent" />
    </div>
  );
}
