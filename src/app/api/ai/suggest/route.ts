import { NextResponse } from "next/server";
import { generateText } from "ai";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { REFINE_SYSTEM, emailContext } from "@/lib/ai/prompts";
import type { Email } from "@/lib/types";

export const maxDuration = 30;

interface Body {
  /** Original email for context — absent for new mail / forwards. */
  email?: Email;
  draft: string;
  instruction: string;
  /** When present, only this span of the draft may change. */
  selection?: { start: number; end: number; text: string };
}

export async function POST(req: Request) {
  const { email, draft, instruction, selection } = (await req.json()) as Body;
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

  try {
    const { text } = await generateText({
      model: resolveModel(cfg),
      system: REFINE_SYSTEM,
      prompt: [
        "以下のメール下書きを、指示に従って修正してください。",
        scope,
        "",
        `指示: ${instruction}`,
        ...(email
          ? ["", "--- 返信対象の元メール（文脈） ---", emailContext(email)]
          : []),
        "",
        "--- 現在の下書き（全文） ---",
        draft,
        "",
        "出力は修正後の下書き全文のみ（前置き・説明・引用符なし）。",
      ].join("\n"),
    });
    return NextResponse.json({ revised: text.trim(), ai: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "suggest failed" },
      { status: 500 },
    );
  }
}
