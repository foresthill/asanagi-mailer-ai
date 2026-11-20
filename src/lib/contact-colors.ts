import type { ContactColor } from "@/lib/types";

/**
 * Sender color palette (差出人で色付け・最小 Rules). Shared by the contact editor
 * (swatches) and the mail list (left accent bar). Hex values are mid-tone so they
 * read on both light and dark backgrounds — we apply them via inline style rather
 * than Tailwind classes, since dynamic class names aren't picked up by the JIT.
 */
export const CONTACT_COLORS: {
  key: ContactColor;
  hex: string;
  labelJa: string;
}[] = [
  { key: "red", hex: "#ef4444", labelJa: "赤" },
  { key: "orange", hex: "#f97316", labelJa: "橙" },
  { key: "amber", hex: "#f59e0b", labelJa: "黄" },
  { key: "green", hex: "#22c55e", labelJa: "緑" },
  { key: "teal", hex: "#14b8a6", labelJa: "青緑" },
  { key: "blue", hex: "#3b82f6", labelJa: "青" },
  { key: "purple", hex: "#a855f7", labelJa: "紫" },
  { key: "pink", hex: "#ec4899", labelJa: "桃" },
];

const HEX = new Map<ContactColor, string>(
  CONTACT_COLORS.map((c) => [c.key, c.hex]),
);

/** Hex for a color key, or undefined for none/unknown. */
export function contactColorHex(color?: ContactColor): string | undefined {
  return color ? HEX.get(color) : undefined;
}
