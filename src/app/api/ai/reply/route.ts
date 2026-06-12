import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { REPLY_SYSTEM, emailContext, historyContext } from "@/lib/ai/prompts";
import { logAiUsage } from "@/lib/db";
import type { DraftRequest } from "@/lib/types";

export const maxDuration = 30;

const draftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export async function POST(req: Request) {
  const { email, guidance, history } = (await req.json()) as DraftRequest;
  const cfg = await loadAIConfig();

  // Graceful fallback so the app works before any API key is configured.
  if (!cfg.configured) {
    const subject = email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`;
    const body = `${email.from.name ?? email.from.email} 様

ご連絡ありがとうございます。内容を確認いたしました。

（ここに返信内容が入ります。AIキーを設定すると自動で下書きが生成されます。）

よろしくお願いいたします。`;
    return NextResponse.json({ draft: { subject, body }, ai: false });
  }

  try {
    const { object, usage } = await generateObject({
      model: resolveModel(cfg),
      schema: draftSchema,
      system: REPLY_SYSTEM,
      prompt: [
        "以下のメールに対する返信の下書きを作成してください。",
        guidance ? `補足の指示: ${guidance}` : "",
        // Conversation so far — agreed dates, open questions, tone.
        ...(history?.length
          ? ["", "--- これまでのやりとり（古い順・抜粋） ---", historyContext(history, email.id)]
          : []),
        "",
        "--- 返信対象の受信メール ---",
        emailContext(email),
      ]
        .filter(Boolean)
        .join("\n"),
    });
    logAiUsage("reply", cfg.model, usage?.inputTokens, usage?.outputTokens);
    return NextResponse.json({ draft: object, ai: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 500 },
    );
  }
}
