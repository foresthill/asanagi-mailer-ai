import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { REPLY_SYSTEM, emailContext, historyContext, replyPerspective } from "@/lib/ai/prompts";
import { getReplySignature, getEmailSettings } from "@/lib/store";
import { logAiUsage } from "@/lib/db";
import { PiiMasker, auditOutgoing } from "@/lib/ai/pii";
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
    // 構造化PIIはローカルでトークン化してから送り、下書き中のトークンは
    // 端末側で原文に戻す（lib/ai/pii.ts — 可逆なので品質を落とさない）。
    const masker = new PiiMasker();
    const target = cfg.piiMask ? masker.maskEmail(email) : email;
    const maskedHistory = cfg.piiMask ? history?.map((m) => masker.maskEmail(m)) : history;
    // 返信の視点（誰が誰に返信するか）を固定する。返信対象が自分の過去メール
    // でも「自分に返信」しないようにし、名乗りはアカウント本人＋任意の署名。
    const signature = await getReplySignature(email.account);
    const settings = await getEmailSettings();
    const selfAddr = (
      email.account === "gmail" ? settings.gmail?.address : settings.imap?.user
    )?.toLowerCase();
    const isOwn = !!selfAddr && email.from.email.toLowerCase() === selfAddr;
    // 自分の過去メールなら差出人名＝自分の名。そうでなければアカウントの表示名。
    const selfName = (isOwn ? email.from.name : settings.imap?.fromName) || undefined;
    const prompt = [
      "以下のメールに対する返信の下書きを作成してください。",
      replyPerspective({ selfName, isOwn, signature }),
      guidance ? `補足の指示: ${guidance}` : "",
      // Conversation so far — agreed dates, open questions, tone.
      ...(maskedHistory?.length
        ? ["", "--- これまでのやりとり（古い順・抜粋） ---", historyContext(maskedHistory, email.id)]
        : []),
      "",
      "--- 返信対象の受信メール ---",
      emailContext(target),
    ]
      .filter(Boolean)
      .join("\n");
    const { object, usage } = await generateObject({
      model: resolveModel(cfg),
      // Explicit output budget: without it some providers reserve the model max
      // (64k) and fail the affordability check when credits run low.
      maxOutputTokens: 2000,
      schema: draftSchema,
      system: REPLY_SYSTEM,
      prompt,
    });
    const logged = `[system]\n${REPLY_SYSTEM}\n\n[prompt]\n${prompt}`;
    logAiUsage("reply", cfg.model, usage?.inputTokens, usage?.outputTokens, {
      prompt: logged,
      response: JSON.stringify(object, null, 2),
      maskAudit: cfg.piiMask ? auditOutgoing("reply", masker, logged) : undefined,
    });
    return NextResponse.json({
      draft: { subject: masker.unmask(object.subject), body: masker.unmask(object.body) },
      ai: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 500 },
    );
  }
}
