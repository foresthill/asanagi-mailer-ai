import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import type { AISettings, Importance } from "@/lib/types";

/**
 * Jev (TypeSafe AI's "System One" model) classifier.
 *
 * Jev doesn't generate text — it returns typed values + confidence, optimized for
 * classification (200x faster / 400x cheaper than LLMs on such tasks). Asanagi's
 * judgment tasks (importance / threat / sweep disposition) are exactly this, so we
 * route them to Jev when a key is set, falling back to the LLM otherwise.
 *
 * BYOK: the key lives only in `.data` (AISettings.jevApiKey). The `state` (mail
 * text) goes to api.typesafe.ai just like the LLM path, so callers mask PII first
 * (same as the LLM classify route).
 */

/** Jev is used for classification only when a key is configured. */
export function isJevEnabled(s: AISettings): boolean {
  return !!s.jevApiKey?.trim();
}

function toImportance(v: string): Importance {
  return v === "high" || v === "low" ? v : "normal";
}

export interface JevClassifyResult {
  importance: Importance;
  threat?: "spam" | "phishing";
  /** 0–1 confidence for the importance pick (for the reason label). */
  importanceConfidence: number;
}

/** Importance + threat in one System One call (parallel questions, one state). */
export async function jevClassify(
  apiKey: string,
  input: { subject: string; from: string; body: string },
): Promise<JevClassifyResult> {
  const client = new TypeSafeClient({ apiKey });
  const state = {
    document: `件名: ${input.subject}\n差出人: ${input.from}\n本文: ${(input.body ?? "").slice(0, 4000)}`,
  };
  const r = await client.systemOne({
    state,
    questions: {
      importance: choice(
        "このメールの重要度は？返信や対応の必要性・緊急性・差出人との関係で判断する。",
        { high: null, normal: null, low: null },
      ),
      threat: choice(
        "このメールの危険性は？ none=通常のメール, spam=迷惑・無差別の宣伝/勧誘, phishing=実在の企業や機関になりすまして認証情報やカード番号の入力・リンククリックを促す詐欺。迷ったら none。",
        { none: null, spam: null, phishing: null },
      ),
    },
  });
  const th = r.answers.threat.choice;
  return {
    importance: toImportance(r.answers.importance.choice),
    threat: th === "spam" || th === "phishing" ? th : undefined,
    importanceConfidence: r.answers.importance.confidence ?? 0,
  };
}

export type SweepDisposition = "keep" | "archive" | "trash";

export interface JevSweepResult {
  disposition: SweepDisposition;
  importance: Importance;
  confidence: number;
}

/** 朝の一凪の処分（残す/アーカイブ/ゴミ箱）＋重要度を1コールで。 */
export async function jevSweep(
  apiKey: string,
  input: { subject: string; from: string; body: string },
): Promise<JevSweepResult> {
  const client = new TypeSafeClient({ apiKey });
  const state = {
    document: `件名: ${input.subject}\n差出人: ${input.from}\n本文: ${(input.body ?? "").slice(0, 4000)}`,
  };
  const r = await client.systemOne({
    state,
    questions: {
      disposition: choice(
        "受信箱の片付けとして、このメールをどうすべき？ keep=残す（要対応・重要）, archive=読んだが保管（通知・情報）, trash=不要（迷惑・無差別宣伝）。",
        { keep: null, archive: null, trash: null },
      ),
      importance: choice("このメールの重要度は？", {
        high: null,
        normal: null,
        low: null,
      }),
    },
  });
  const d = r.answers.disposition.choice;
  return {
    disposition: d === "archive" || d === "trash" ? d : "keep",
    importance: toImportance(r.answers.importance.choice),
    confidence: r.answers.disposition.confidence ?? 0,
  };
}
