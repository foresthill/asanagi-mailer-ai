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
