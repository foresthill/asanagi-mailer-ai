import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import {
  REPLY_SYSTEM,
  emailContext,
  historyContext,
  replyPerspective,
  writingNoteBlock,
} from "@/lib/ai/prompts";
import { getReplySignature, getEmailSettings, getWritingNote } from "@/lib/store";
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
    const nerOn = cfg.piiMask && cfg.nerMask;
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
    // 自分の送信メールに対する操作は「返信」ではなく「フォローアップ」。相手が
    // まだ返していないメールに"返信"させると、AIが相手の受領返事を代筆して
    // 相手になりすます（＝送信事故）。isOwn なら追加連絡として組み立てる。
    const mode: "reply" | "followup" = isOwn ? "followup" : "reply";
    // 宛名にする相手＝なりすまし禁止対象。フォローアップは元メールの宛先、
    // 通常返信は差出人。
    const counterpartyName =
      (mode === "followup" ? email.to?.[0]?.name : email.from.name) || undefined;

    // Opt-in NER masking of 人名・社名. Learn entities from the whole thread FIRST,
    // then force-register the principal names — all BEFORE masking the email, so
    // the body, address fields AND the perspective guard tokenize them
    // consistently (reversible → identity logic and unmasked output unchanged).
    if (nerOn) {
      await masker.learnEntities([
        email.subject,
        email.body,
        email.from.name,
        ...(email.to?.map((t) => t.name) ?? []),
        ...(history?.flatMap((h) => [h.subject, h.body]) ?? []),
      ]);
    }
    const pSelfName = nerOn ? masker.maskName(selfName) : selfName;
    const pCounterparty = nerOn ? masker.maskName(counterpartyName) : counterpartyName;

    const target = cfg.piiMask ? masker.maskEmail(email) : email;
    const maskedHistory = cfg.piiMask ? history?.map((m) => masker.maskEmail(m)) : history;
    const pSignature = nerOn && signature ? masker.mask(signature) : signature;
    const writingNote = await getWritingNote();
    const prompt = [
      mode === "followup"
        ? "以下は、あなたが既に送信したメールです。同じ宛先への追加連絡（フォローアップ／リマインド）の下書きを作成してください。相手からの返信を書くのではありません。"
        : "以下のメールに対する返信の下書きを作成してください。",
      replyPerspective({
        selfName: pSelfName,
        counterpartyName: pCounterparty,
        mode,
        signature: pSignature,
      }),
      writingNoteBlock(writingNote),
      guidance ? `補足の指示: ${guidance}` : "",
      // Conversation so far — agreed dates, open questions, tone.
      ...(maskedHistory?.length
        ? ["", "--- これまでのやりとり（古い順・抜粋） ---", historyContext(maskedHistory, email.id)]
        : []),
      "",
      mode === "followup" ? "--- あなたが送信した元メール ---" : "--- 返信対象の受信メール ---",
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
