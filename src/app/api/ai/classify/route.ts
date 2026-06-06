import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { CLASSIFY_SYSTEM, classifyContext } from "@/lib/ai/prompts";
import { guessFromSignals, listSignals } from "@/lib/store";
import type { Email, Importance } from "@/lib/types";

export const maxDuration = 30;

const schema = z.object({
  importance: z.enum(["high", "normal", "low"]),
  reason: z.string(),
});

export async function POST(req: Request) {
  const { email } = (await req.json()) as { email: Email };
  const signals = await listSignals();

  // Heuristic short-circuit: if the user has already taught us about this
  // sender/domain, trust that immediately (fast + free + personalized).
  const learned = guessFromSignals(email.from.email, signals);
  if (learned) {
    return NextResponse.json({
      importance: learned,
      reason: "あなたの過去の判断（学習済み）に基づく判定です。",
      source: "learned",
    });
  }

  const cfg = await loadAIConfig();
  if (!cfg.configured) {
    // Crude keyword fallback so the UI still shows something useful.
    const subj = email.subject;
    const high = /要返信|至急|緊急|重要|締切|請求|important|urgent|deadline/i.test(subj);
    const low = /newsletter|配信|お知らせ|news|週刊|promotion/i.test(subj + email.from.email);
    const importance: Importance = high ? "high" : low ? "low" : "normal";
    return NextResponse.json({
      importance,
      reason: "キーワードに基づく簡易判定です（AIキー未設定）。",
      source: "heuristic",
    });
  }

  try {
    const { object } = await generateObject({
      model: resolveModel(cfg),
      schema,
      system: CLASSIFY_SYSTEM,
      prompt: classifyContext(email, signals),
    });
    return NextResponse.json({ ...object, source: "ai" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "classify failed" },
      { status: 500 },
    );
  }
}
