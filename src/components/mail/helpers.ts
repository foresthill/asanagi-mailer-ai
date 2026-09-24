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
  return (
    (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "")
  );
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

/**
 * A compact preview that skips boilerplate openers — the honorific address
 * line (「〜様」), the standard greeting (「お世話になっております」etc.), quoted
 * history (「>」) and separators — so distinct messages read differently in a
 * dense list (the outline rail). Pure string work, no AI. Falls back to the
 * snippet/subject when nothing substantive remains (e.g. a one-line greeting).
 */
export function bodyPreview(email: {
  body?: string;
  snippet?: string;
  subject?: string;
}): string {
  const raw = (email.body || email.snippet || "")
    .replace(/\r/g, "")
    .replace(/　/g, " ");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const isBoiler = (l: string) =>
    (l.length <= 24 && /(様|さま|さん|殿|御中)$/.test(l)) || // 宛名行
    // 会社名だけの行（宛名の一部）。句読点を含まない短い行に限定して誤爆を防ぐ。
    (l.length <= 30 &&
      !/[。！？!?]/.test(l) &&
      (/^(株式会社|有限会社|合同会社)/.test(l) ||
        /(株式会社|有限会社|合同会社|御中)$/.test(l))) ||
    /(お世話に(なって|なり)|いつもお世話|大変お世話|ご無沙汰|恐れ入り|平素|拝啓|突然のご連絡|ご連絡(いたしました|申し上げ))/.test(
      l,
    ) || // 定型挨拶
    /^>/.test(l) || // 引用
    /^[-—=_*]{2,}$/.test(l); // 区切り線
  const kept = lines.filter((l) => !isBoiler(l));
  const text = (kept.length ? kept : lines)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text || email.snippet || email.subject || "";
}

/** Extract the concatenated text of a UIMessage's text parts. */
export function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}
