/**
 * Plain-text → HTML helpers for the "HTMLで送信" mode (compose.ts §A).
 * Pure (no DOM) so it runs on both client and server. Quoted-original HTML is
 * sanitized separately in the composer with DOMPurify (browser-only).
 */

/** Escape the five HTML-significant characters. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Wrap bare http(s) URLs (already HTML-escaped) in anchors. */
function linkify(escaped: string): string {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
}

/**
 * Convert a plain-text block into an HTML fragment: escape, linkify bare URLs,
 * and turn newlines into <br>. Safe to embed in an email's HTML part.
 */
export function plainTextToHtml(text: string): string {
  return linkify(escapeHtml(text)).replace(/\r?\n/g, "<br>\n");
}

/** Outer wrapper applied to the assembled HTML body (basic readable styling). */
export function wrapHtmlBody(inner: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#111">${inner}</div>`;
}

/** Gmail-style quoted-block wrapper for the original message in a reply. */
export function quoteBlock(innerHtml: string): string {
  return `<blockquote style="margin:0.8em 0 0 0;padding-left:1em;border-left:2px solid #ccc;color:#555">${innerHtml}</blockquote>`;
}

/** An inline image pulled out of an HTML body for cid embedding. */
export interface InlineImage {
  filename: string;
  mimeType: string;
  /** base64 content (no data: prefix). */
  content: string;
  size: number;
  cid: string;
}

/**
 * Replace `src="data:<mime>;base64,…"` image sources with `cid:` references and
 * return the rewritten HTML plus the extracted images. Used at send time so the
 * editor can hold base64 data URLs while the wire format uses multipart/related.
 */
export function extractInlineImages(html: string): { html: string; inline: InlineImage[] } {
  const inline: InlineImage[] = [];
  let n = 0;
  const out = html.replace(
    /src="data:([^;"]+);base64,([^"]+)"/g,
    (_m, mime: string, b64: string) => {
      n += 1;
      const cid = `img${n}-${globalThis.crypto.randomUUID()}@asanagi`;
      const ext = (mime.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
      inline.push({
        filename: `image${n}.${ext}`,
        mimeType: mime,
        content: b64,
        size: Math.floor((b64.length * 3) / 4),
        cid,
      });
      return `src="cid:${cid}"`;
    },
  );
  return { html: out, inline };
}
