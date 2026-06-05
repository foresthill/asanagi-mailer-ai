import type { UIMessage } from "ai";
import type { EmailAddress } from "@/lib/types";

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
