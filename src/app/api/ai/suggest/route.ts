import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { REFINE_SYSTEM, emailContext } from "@/lib/ai/prompts";
import { logAiUsage } from "@/lib/db";
import type { Email } from "@/lib/types";

export const maxDuration = 30;

interface Body {
  /** Original email for context — absent for new mail / forwards. */
  email?: Email;
  draft: string;
  instruction: string;
  /** When present, only this span of the draft may change. */
  selection?: { start: number; end: number; text: string };
  /** Current subject line — blank means "please propose one too". */
  subject?: string;
}

export async function POST(req: Request) {
  const { email, draft, instruction, selection, subject } = (await req.json()) as Body;
  const cfg = await loadAIConfig();

  // No key: return the draft unchanged → client computes "変更なし".
  if (!cfg.configured) {
    return NextResponse.json({ revised: draft, ai: false });
  }

  const scope = selection?.text
    ? [
        "【重要】修正してよいのは次の「対象範囲」だけです。それ以外は一字一句変更しないでください。",
        "対象範囲:",
        "<<<",
        selection.text,
        ">>>",
      ].join("\n")
    : "下書き全体を対象に、指示に関係する箇所のみ最小限で修正してください。";

  // Subject relief: when the user hasn't written one, have the model propose
  // it alongside the revision (件名を考えるのがしんどい問題).
  const needSubject = !subject?.trim();
  const schema = needSubject
    ? z.object({
        revised: z.string(),
        subject: z
          .string()
          .describe("この下書きに合う簡潔な日本語の件名（25文字以内、Re:/Fwd:は付けない）"),
      })
    : z.object({ revised: z.string() });

  try {
    const { object, usage } = await generateObject({
      model: resolveModel(cfg),
      schema,
      system: REFINE_SYSTEM,
      prompt: [
        "以下のメール下書きを、指示に従って修正してください。",
        scope,
        "",
        `指示: ${instruction}`,
        ...(needSubject
          ? ["", "件名が未入力です。subject にこの下書きに合う簡潔な件名も提案してください。"]
          : []),
        ...(email
          ? ["", "--- 返信対象の元メール（文脈） ---", emailContext(email)]
          : []),
        "",
        "--- 現在の下書き（全文） ---",
        draft,
        "",
        "revised には修正後の下書き全文のみを入れてください（前置き・説明・引用符なし）。",
      ].join("\n"),
    });
    logAiUsage("suggest", cfg.model, usage?.inputTokens, usage?.outputTokens);
    const out = object as { revised: string; subject?: string };
    return NextResponse.json({
      revised: out.revised.trim(),
      subject: needSubject ? out.subject?.trim() : undefined,
      ai: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "suggest failed" },
      { status: 500 },
    );
  }
}
