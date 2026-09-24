import type { Email, Importance, ImportanceSignal } from "@/lib/types";
import { guessFromSignals } from "@/lib/store";

/**
 * Tiered importance (docs/02): the free, instant layers used to annotate
 * whole lists without AI cost. The LLM refines individual emails on open.
 *   1. learned signals (user feedback on sender/domain) — personalized
 *   2. keyword heuristic — generic fallback
 */

/**
 * A project key for mail that shares one sender across many projects — chiefly
 * GitHub/GitLab notifications (all from notifications@github.com), where the
 * repo is the real unit of interest. Extracted from the subject's「[owner/repo]」.
 * Lets the user teach importance PER PROJECT (自社repo=中 / bitcoin/bips=低) even
 * though the sender is identical. Returns e.g. "repo:bitcoin/bips" or null.
 */
export function projectKeyFromSubject(subject?: string): string | undefined {
  const m = (subject ?? "").match(/\[([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\]/);
  return m ? `repo:${m[1].toLowerCase()}` : undefined;
}

/** Generic keyword guess; cheap enough to run on every list item. */
export function heuristicImportance(email: Email): Importance {
  const subj = email.subject;
  if (/要返信|至急|緊急|重要|締切|請求|important|urgent|deadline/i.test(subj)) return "high";
  // Promo words match the SUBJECT only — matching the raw sender address
  // caused false positives (e.g. a real meeting invite sent from a domain
  // like "dentsupromotion.co.jp" tripping on "promotion").
  if (
    /newsletter|メルマガ|配信停止|お知らせ|news|週刊|月刊|セール|sale|キャンペーン|promotion|\[PR\]|【PR】/i.test(
      subj,
    )
  ) {
    return "low";
  }
  // Sender-side: only unambiguous bulk-mail local parts (before the @).
  const localPart = email.from.email.split("@")[0] ?? "";
  if (/^(newsletter|news|mailmag|magazine|mailmagazine|promo|campaign)$/i.test(localPart)) {
    return "low";
  }
  return "normal";
}

/** Annotate a list with the free layers (learned > keyword). No AI calls. */
export function annotateImportance(emails: Email[], signals: ImportanceSignal[]): Email[] {
  return emails.map((e) => {
    if (e.importance) return e;
    const learned = guessFromSignals(e.from.email, signals, projectKeyFromSubject(e.subject));
    return { ...e, importance: learned ?? heuristicImportance(e) };
  });
}
