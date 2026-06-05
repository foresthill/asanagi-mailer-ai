import { diffArrays } from "diff";

/**
 * Sentence-level diff for the "一箇所ずつ採用/却下" editing UX.
 *
 * Word-diff doesn't work for Japanese (no spaces) and char-diff is too noisy,
 * so we split into sentences (keeping their delimiters) and diff those arrays.
 * The result is a flat list of segments: unchanged text, or a "hunk" that the
 * user accepts (use `after`) or rejects (keep `before`).
 */
export type Segment =
  | { type: "same"; text: string }
  | {
      type: "hunk";
      id: string;
      before: string; // original text ("" = pure insertion)
      after: string; //  proposed text ("" = pure deletion)
      status: "pending" | "accepted" | "rejected";
    };

/** Split keeping the delimiter attached (。．.!?！？ and newlines). */
function splitSentences(text: string): string[] {
  if (!text) return [];
  return text.split(/(?<=[。．.!?！？\n])/).filter((s) => s.length > 0);
}

export function buildSegments(current: string, revised: string): Segment[] {
  const parts = diffArrays(splitSentences(current), splitSentences(revised));
  const segments: Segment[] = [];
  let hunkSeq = 0;

  for (let i = 0; i < parts.length; ) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      segments.push({ type: "same", text: part.value.join("") });
      i++;
      continue;
    }
    // Collect a contiguous run of added/removed parts into one hunk.
    let before = "";
    let after = "";
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      if (parts[i].removed) before += parts[i].value.join("");
      else after += parts[i].value.join("");
      i++;
    }
    segments.push({
      type: "hunk",
      id: `h${hunkSeq++}`,
      before,
      after,
      status: "pending",
    });
  }
  return segments;
}

export function hasPending(segments: Segment[]): boolean {
  return segments.some((s) => s.type === "hunk" && s.status === "pending");
}

export function pendingCount(segments: Segment[]): number {
  return segments.filter((s) => s.type === "hunk" && s.status === "pending").length;
}

/**
 * Reconstruct the draft text from segments.
 * `pendingAs` decides how not-yet-decided hunks render ("before" keeps original).
 */
export function resolveText(segments: Segment[], pendingAs: "before" | "after" = "before"): string {
  return segments
    .map((s) => {
      if (s.type === "same") return s.text;
      if (s.status === "accepted") return s.after;
      if (s.status === "rejected") return s.before;
      return pendingAs === "after" ? s.after : s.before;
    })
    .join("");
}
