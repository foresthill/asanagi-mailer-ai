import type { UIMessage } from "ai";
import type { EmailAddress } from "@/lib/types";
import { decodeEntities } from "@/lib/email/encoding";

/**
 * HTML mail → readable plain text (for "全文コピー"). Block tags become line
 * breaks, list items become bullets, all remaining tags are stripped and
 * entities decoded — so copying an HTML mail yields text, never markup.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<li[^>]*>/gi, "\n・")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|ul|ol|h[1-6]|blockquote|table)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t 　]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function initials(addr: EmailAddress): string {
  const base = addr.name?.trim() || addr.email;
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

export function displayName(addr: EmailAddress): string {
  return addr.name?.trim() || addr.email;
}

/** Deterministic pleasant color from a string (for avatars). */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h} 52% 58%)`;
}

export function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "たった今";
  if (diff < hr) return `${Math.floor(diff / min)}分前`;
  if (diff < day) return `${Math.floor(diff / hr)}時間前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}日前`;
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Extract the concatenated text of a UIMessage's text parts. */
export function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}
