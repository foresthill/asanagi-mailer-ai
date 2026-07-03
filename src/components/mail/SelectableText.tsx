"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Plain-text body wrapper with deterministic click-to-select:
 *  - double-click → select the LINE under the cursor (up to newlines). Native
 *    double-click "word" selection is unreliable for Japanese (no spaces
 *    between words → it grabs a huge run), so we take over.
 *  - triple-click → select the whole body.
 * Single click is left alone (native caret placement). HTML mail renders in an
 * iframe and is browser-controlled, so this only applies to plain-text bodies.
 */
function caretPositionFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  // Standard API + WebKit (Safari/Chrome) fallback.
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

function selectRange(range: Range) {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function selectLineAt(x: number, y: number, root: HTMLElement): boolean {
  const pos = caretPositionFromPoint(x, y);
  if (!pos || !root.contains(pos.node) || pos.node.nodeType !== Node.TEXT_NODE) return false;
  const text = pos.node.textContent ?? "";
  let start = pos.offset;
  let end = pos.offset;
  while (start > 0 && text[start - 1] !== "\n") start--;
  while (end < text.length && text[end] !== "\n") end++;
  const range = document.createRange();
  range.setStart(pos.node, start);
  range.setEnd(pos.node, end);
  selectRange(range);
  return true;
}

export function SelectableText({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  return (
    <article
      ref={ref}
      className={className}
      style={style}
      onClick={(e) => {
        const root = ref.current;
        if (!root) return;
        if (e.detail === 3) {
          const range = document.createRange();
          range.selectNodeContents(root);
          selectRange(range);
        } else if (e.detail === 2) {
          selectLineAt(e.clientX, e.clientY, root);
        }
      }}
    >
      {children}
    </article>
  );
}
