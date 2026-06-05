import type { JSONContent } from "@tiptap/core";
import type { Segment } from "@/lib/diff";

/**
 * Conversions between plain email text and a single-paragraph ProseMirror
 * document. Newlines are modeled as hardBreak nodes (the editor allows exactly
 * one paragraph), which keeps text<->doc round-tripping lossless and avoids
 * multi-paragraph position math when placing inline suggestion nodes.
 */

/** Inline content for a run of plain text (text nodes + hardBreaks for \n). */
export function inlineFromText(text: string): JSONContent[] {
  const out: JSONContent[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: "hardBreak" });
    if (line.length > 0) out.push({ type: "text", text: line });
  });
  return out;
}

export function docFromText(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: inlineFromText(text) }],
  };
}

/** Build a review document: unchanged text + inline `suggestion` atom nodes. */
export function reviewDoc(segments: Segment[]): JSONContent {
  const content: JSONContent[] = [];
  for (const seg of segments) {
    if (seg.type === "same") {
      content.push(...inlineFromText(seg.text));
    } else {
      content.push({
        type: "suggestion",
        attrs: { before: seg.before, after: seg.after, sid: seg.id },
      });
    }
  }
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

/** Serialize the editor doc back to plain text. Unresolved suggestions
 *  fall back to their original text (`before`). */
export function serializeDoc(json: JSONContent): string {
  const para = json.content?.[0];
  if (!para?.content) return "";
  let s = "";
  for (const n of para.content) {
    if (n.type === "text") s += n.text ?? "";
    else if (n.type === "hardBreak") s += "\n";
    else if (n.type === "suggestion") s += (n.attrs?.before as string) ?? "";
  }
  return s;
}

export function countSuggestions(json: JSONContent): number {
  const para = json.content?.[0];
  if (!para?.content) return 0;
  return para.content.filter((n) => n.type === "suggestion").length;
}
