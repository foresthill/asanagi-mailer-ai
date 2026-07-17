"use client";

import { useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { ImageOff, Image as ImageIcon } from "lucide-react";
import { parseTerms } from "./highlight";

/**
 * Safe rich rendering of HTML mail:
 *  - DOMPurify strips scripts / event handlers / dangerous markup
 *  - rendered inside a sandboxed iframe (no scripts; links open in new tabs)
 *  - remote images are BLOCKED by default (tracking-pixel privacy, local-first)
 *    and loaded only when the user opts in per email
 */
/**
 * Wrap search-term matches in <mark class="asanagi-hl"> inside the parsed mail
 * DOM (text nodes only — never touches tags/attributes, so markup can't break).
 * Case-insensitive; skips script/style. Runs on the already-sanitized doc.
 */
function highlightDom(doc: Document, terms: string[]) {
  if (!terms.length) return;
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lowTerms = terms.map((t) => t.toLowerCase());
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = node.parentElement?.tagName;
      if (!tag || tag === "SCRIPT" || tag === "STYLE" || tag === "MARK") {
        return NodeFilter.FILTER_REJECT;
      }
      const v = (node.nodeValue ?? "").toLowerCase();
      return lowTerms.some((t) => v.includes(t)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as Text);
  for (const node of targets) {
    const text = node.nodeValue ?? "";
    const frag = doc.createDocumentFragment();
    re.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
      const mark = doc.createElement("mark");
      mark.className = "asanagi-hl";
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
    }
    if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
}

export function HtmlMailView({
  html,
  fontScale = 1,
  embedded = false,
  highlight,
}: {
  html: string;
  fontScale?: number;
  /** Inside a thread card: drop the frame (border/rounded/top margin) so the
   *  card's own padding is the only padding — no "box inside a box". */
  embedded?: boolean;
  /** Search query to highlight in the mail body (search mode only). */
  highlight?: string;
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

    highlightDom(doc, parseTerms(highlight));

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
  mark.asanagi-hl { background: #fde68a; color: inherit; border-radius: 2px; padding: 0 1px; }
</style></head><body>${body}</body></html>`,
    };
  }, [html, showImages, fontScale, highlight]);

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
