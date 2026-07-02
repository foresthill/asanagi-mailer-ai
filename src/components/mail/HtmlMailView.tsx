"use client";

import { useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { ImageOff, Image as ImageIcon } from "lucide-react";

/**
 * Safe rich rendering of HTML mail:
 *  - DOMPurify strips scripts / event handlers / dangerous markup
 *  - rendered inside a sandboxed iframe (no scripts; links open in new tabs)
 *  - remote images are BLOCKED by default (tracking-pixel privacy, local-first)
 *    and loaded only when the user opts in per email
 */
export function HtmlMailView({
  html,
  fontScale = 1,
  embedded = false,
}: {
  html: string;
  fontScale?: number;
  /** Inside a thread card: drop the frame (border/rounded/top margin) so the
   *  card's own padding is the only padding — no "box inside a box". */
  embedded?: boolean;
}) {
  const [showImages, setShowImages] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { srcDoc, blockedImages } = useMemo(() => {
    const clean = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["form", "input", "button"],
    });

    // Neutralize remote images unless the user opted in.
    let blocked = 0;
    const doc = new DOMParser().parseFromString(clean, "text/html");
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (/^https?:/i.test(src)) {
        blocked++;
        if (!showImages) {
          img.setAttribute("data-blocked-src", src);
          img.removeAttribute("src");
          img.setAttribute("alt", img.getAttribute("alt") || "（画像ブロック中）");
          img.setAttribute(
            "style",
            `${img.getAttribute("style") ?? ""};background:#f1f0ee;min-height:24px;`,
          );
        }
      }
    });

    const body = doc.body.innerHTML;
    return {
      blockedImages: blocked,
      srcDoc: `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>
  body { margin: 0; padding: 4px 2px; font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
         font-size: ${Math.round(15 * fontScale)}px; line-height: 1.7; color: #2b2a28; word-break: break-word; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #5a52c7; }
  blockquote { border-left: 2px solid #ddd; margin-left: 0; padding-left: 1em; color: #666; }
</style></head><body>${body}</body></html>`,
    };
  }, [html, showImages, fontScale]);

  // Sized to content. sandbox has NO allow-scripts, so allow-same-origin is
  // safe here and lets us measure the document height.
  const fit = () => {
    const el = iframeRef.current;
    const h = el?.contentDocument?.documentElement?.scrollHeight;
    if (el && h) el.style.height = `${Math.min(h + 8, 20000)}px`;
  };

  return (
    <div className={embedded ? "" : "mt-6"}>
      {blockedImages > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-[11px] text-fg-muted">
          {showImages ? (
            <>
              <ImageIcon className="size-3.5" />
              リモート画像を表示中
              <button
                onClick={() => setShowImages(false)}
                className="ml-auto text-fg-subtle underline hover:text-fg"
              >
                ブロックに戻す
              </button>
            </>
          ) : (
            <>
              <ImageOff className="size-3.5" />
              プライバシー保護のためリモート画像{blockedImages}件をブロック中
              <button
                onClick={() => setShowImages(true)}
                className="ml-auto text-accent underline hover:opacity-80"
              >
                画像を表示
              </button>
            </>
          )}
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        onLoad={fit}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        title="メール本文"
        className={
          embedded ? "w-full bg-white" : "w-full rounded-lg border border-border bg-white"
        }
        style={{ height: 400 }}
      />
    </div>
  );
}
