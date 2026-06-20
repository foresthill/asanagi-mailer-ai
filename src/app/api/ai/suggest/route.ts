import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { REFINE_SYSTEM, emailContext } from "@/lib/ai/prompts";
import { logAiUsage } from "@/lib/db";
import { PiiMasker } from "@/lib/ai/pii";
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
    // 構造化PIIをローカルでトークン化（下書き・元メール・選択範囲すべて
    // 同じトークン表を共有）。出力は端末側で原文に復元する。
    const masker = new PiiMasker();
    const maskedDraft = cfg.piiMask ? masker.mask(draft) : draft;
    const maskedEmail = cfg.piiMask && email ? masker.maskEmail(email) : email;
    const maskedSel = cfg.piiMask && selection?.text ? masker.mask(selection.text) : selection?.text;
    const scope = maskedSel
      ? [
          "【重要】修正してよいのは次の「対象範囲」だけです。それ以外は一字一句変更しないでください。",
          "対象範囲:",
          "<<<",
          maskedSel,
          ">>>",
        ].join("\n")
      : "下書き全体を対象に、指示に関係する箇所のみ最小限で修正してください。";
    const prompt = [
      "以下のメール下書きを、指示に従って修正してください。",
      scope,
      "",
      `指示: ${instruction}`,
      ...(needSubject
        ? ["", "件名が未入力です。subject にこの下書きに合う簡潔な件名も提案してください。"]
        : []),
      ...(maskedEmail
        ? ["", "--- 返信対象の元メール（文脈） ---", emailContext(maskedEmail)]
        : []),
      "",
      "--- 現在の下書き（全文） ---",
      maskedDraft,
      "",
      "revised には修正後の下書き全文のみを入れてください（前置き・説明・引用符なし）。",
    ].join("\n");
    const { object, usage } = await generateObject({
      model: resolveModel(cfg),
      // Explicit output budget: without it some providers reserve the model max
      // (64k) and fail the affordability check when credits run low.
      maxOutputTokens: 4000,
      schema,
      system: REFINE_SYSTEM,
      prompt,
    });
    logAiUsage("suggest", cfg.model, usage?.inputTokens, usage?.outputTokens, {
      prompt: `[system]\n${REFINE_SYSTEM}\n\n[prompt]\n${prompt}`,
      response: JSON.stringify(object, null, 2),
    });
    const out = object as { revised: string; subject?: string };
    return NextResponse.json({
      revised: masker.unmask(out.revised.trim()),
      subject: needSubject ? masker.unmask(out.subject?.trim() ?? "") || undefined : undefined,
      ai: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "suggest failed" },
      { status: 500 },
    );
  }
}
