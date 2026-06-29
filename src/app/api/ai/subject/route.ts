import { NextResponse } from "next/server";
import { generateText } from "ai";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { SUBJECT_SYSTEM } from "@/lib/ai/prompts";
import { logAiUsage } from "@/lib/db";
import { PiiMasker } from "@/lib/ai/pii";

export const maxDuration = 30;

/** On-demand subject generation from the current body (compose helper). */
export async function POST(req: Request) {
  const { body } = (await req.json()) as { body?: string };
  if (!body?.trim()) {
    return NextResponse.json({ error: "本文が空です" }, { status: 400 });
  }

  const cfg = await loadAIConfig();
  if (!cfg.configured) {
    // No key: fall back to the first non-empty, non-quoted line, trimmed.
    const line = body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith(">"));
    return NextResponse.json({ subject: (line ?? "").slice(0, 60), ai: false });
  }

  try {
    // Body goes to the BYOK provider → mask structured PII first (関所), unmask
    // on the way out so the suggested subject reads naturally.
    const masker = new PiiMasker();
    const masked = cfg.piiMask ? masker.mask(body) : body;
    const prompt = `次のメール本文にふさわしい件名を1つだけ返してください。\n\n--- 本文 ---\n${masked}`;
    const { text, usage } = await generateText({
      model: resolveModel(cfg),
      maxOutputTokens: 100,
      system: SUBJECT_SYSTEM,
      prompt,
    });
    // Models sometimes wrap the line in quotes — strip them.
    const subject = masker
      .unmask(text)
      .trim()
      .replace(/^["'「『]+|["'」』]+$/g, "")
      .slice(0, 120);
    logAiUsage("subject", cfg.model, usage?.inputTokens, usage?.outputTokens, {
      prompt: `[system]\n${SUBJECT_SYSTEM}\n\n[prompt]\n${prompt}`,
      response: subject,
    });
    return NextResponse.json({ subject, ai: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 500 },
    );
  }
}
