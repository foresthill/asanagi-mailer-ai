import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { CLASSIFY_SYSTEM, classifyContext, profileBlock } from "@/lib/ai/prompts";
import { getJudgmentProfile, guessFromSignals, listSignals } from "@/lib/store";
import { heuristicImportance } from "@/lib/importance";
import { PiiMasker } from "@/lib/ai/pii";
import { logAiUsage, logJudgment } from "@/lib/db";
import type { Email, Importance } from "@/lib/types";

export const maxDuration = 30;

const schema = z.object({
  importance: z.enum(["high", "normal", "low"]),
  reason: z.string(),
});

/** Persist every judgment — the supervised-learning log (仕分けレビュー). */
function record(email: Email, importance: Importance, reason: string, source: string) {
  try {
    logJudgment({
      account: email.account ?? "unknown",
      emailId: email.id,
      subject: email.subject,
      fromName: email.from.name,
      fromEmail: email.from.email,
      importance,
      reason,
      source,
    });
  } catch {
    /* logging must never break classification */
  }
}

export async function POST(req: Request) {
  const { email } = (await req.json()) as { email: Email };
  const signals = await listSignals();

  // Heuristic short-circuit: if the user has already taught us about this
  // sender/domain, trust that immediately (fast + free + personalized).
  const learned = guessFromSignals(email.from.email, signals);
  if (learned) {
    const reason = "あなたの過去の判断（学習済み）に基づく判定です。";
    record(email, learned, reason, "learned");
    return NextResponse.json({ importance: learned, reason, source: "learned" });
  }

  const cfg = await loadAIConfig();
  if (!cfg.configured) {
    // Keyword fallback (shared with the list annotator) so the UI still works.
    const importance = heuristicImportance(email);
    const reason = "キーワードに基づく簡易判定です（AIキー未設定）。";
    record(email, importance, reason, "heuristic");
    return NextResponse.json({ importance, reason, source: "heuristic" });
  }

  try {
    // 構造化PIIはローカルでトークン化してから送る（lib/ai/pii.ts）。
    const masker = new PiiMasker();
    const target = cfg.piiMask ? masker.maskEmail(email) : email;
    // 嗜好メモ（ユーザー自筆の指示）はマスクせず素のまま注入する。
    const profile = await getJudgmentProfile();
    const prompt = classifyContext(target, signals) + profileBlock(profile);
    const { object, usage } = await generateObject({
      model: resolveModel(cfg),
      // Explicit output budget: without it some providers reserve the model max
      // (64k) and fail the affordability check when credits run low.
      maxOutputTokens: 300,
      schema,
      system: CLASSIFY_SYSTEM,
      prompt,
    });
    record(email, object.importance, object.reason, "ai");
    logAiUsage("classify", cfg.model, usage?.inputTokens, usage?.outputTokens, {
      prompt: `[system]\n${CLASSIFY_SYSTEM}\n\n[prompt]\n${prompt}`,
      response: JSON.stringify(object, null, 2),
    });
    return NextResponse.json({ ...object, reason: masker.unmask(object.reason), source: "ai" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "classify failed" },
      { status: 500 },
    );
  }
}
