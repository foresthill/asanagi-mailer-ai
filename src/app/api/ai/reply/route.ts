import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { REPLY_SYSTEM, emailContext } from "@/lib/ai/prompts";
import type { DraftRequest } from "@/lib/types";

export const maxDuration = 30;

const draftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export async function POST(req: Request) {
  const { email, guidance } = (await req.json()) as DraftRequest;
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
    const { object } = await generateObject({
      model: resolveModel(cfg),
      schema: draftSchema,
      system: REPLY_SYSTEM,
      prompt: [
        "以下のメールに対する返信の下書きを作成してください。",
        guidance ? `補足の指示: ${guidance}` : "",
        "",
        "--- 受信メール ---",
        emailContext(email),
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return NextResponse.json({ draft: object, ai: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 500 },
    );
  }
}
