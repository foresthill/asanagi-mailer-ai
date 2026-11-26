import { NextResponse } from "next/server";
import { streamObject } from "ai";
import { z } from "zod";
import { loadActiveAIConfig, resolveModel } from "@/lib/ai/model";
import {
  REPLY_SYSTEM,
  emailContext,
  historyContext,
  replyPerspective,
  writingNoteBlock,
} from "@/lib/ai/prompts";
import {
  getReplySignature,
  getEmailSettings,
  getWritingNote,
  getTeamRulesSettings,
} from "@/lib/store";
import { readTeamRules } from "@/lib/integrations/team-rules";
import { logAiUsage } from "@/lib/db";
import { PiiMasker, auditOutgoing } from "@/lib/ai/pii";
import type { DraftRequest } from "@/lib/types";

export const maxDuration = 60;

const draftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

/** 下書きの逐次配信フォーマット（NDJSON・1行＝1スナップショット）。 */
type DraftSnapshot = {
  subject?: string;
  body?: string;
  done?: boolean;
  ai?: boolean;
  error?: string;
};

/** 単発（AI未設定のフォールバック等）を同じNDJSON形式で返す。 */
function ndjsonOnce(obj: DraftSnapshot): Response {
  return new Response(JSON.stringify(obj) + "\n", {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  const { email, guidance, history } = (await req.json()) as DraftRequest;
  const cfg = await loadActiveAIConfig();

  // Graceful fallback so the app works before any API key is configured.
  // Streaming clients read NDJSON uniformly, so the fallback is a single line.
  if (!cfg.configured) {
    const subject = email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`;
    const body = `${email.from.name ?? email.from.email} 様

ご連絡ありがとうございます。内容を確認いたしました。

（ここに返信内容が入ります。AIキーを設定すると自動で下書きが生成されます。）

よろしくお願いいたします。`;
    return ndjsonOnce({ subject, body, done: true, ai: false });
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
    const teamRules = await readTeamRules(await getTeamRulesSettings());
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
      writingNoteBlock(writingNote, teamRules),
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
    const result = streamObject({
      model: resolveModel(cfg),
      // Explicit output budget: without it some providers reserve the model max
      // (64k) and fail the affordability check when credits run low.
      maxOutputTokens: 2000,
      schema: draftSchema,
      system: REPLY_SYSTEM,
      prompt,
    });
    const logged = `[system]\n${REPLY_SYSTEM}\n\n[prompt]\n${prompt}`;

    // マスクトークンが途中で切れている末尾は保留し、完成部分だけ復元して流す
    // （部分JSONの subject/body それぞれに適用）。translate/ask と同じ方針。
    const safeUnmask = (s: string | undefined, final: boolean): string => {
      if (!s) return "";
      let end = s.length;
      if (!final) {
        const open = s.lastIndexOf("[");
        if (open !== -1 && s.indexOf("]", open) === -1) end = open;
      }
      const safe = s.slice(0, end);
      return cfg.piiMask ? masker.unmask(safe) : safe;
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: DraftSnapshot) =>
          controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
        try {
          for await (const partial of result.partialObjectStream) {
            send({
              subject: safeUnmask(partial.subject, false),
              body: safeUnmask(partial.body, false),
              done: false,
            });
          }
          const object = await result.object;
          const subject = cfg.piiMask ? masker.unmask(object.subject) : object.subject;
          const body = cfg.piiMask ? masker.unmask(object.body) : object.body;
          send({ subject, body, done: true, ai: true });
          const usage = await result.usage;
          logAiUsage("reply", cfg.model, usage?.inputTokens, usage?.outputTokens, {
            prompt: logged,
            response: JSON.stringify({ subject, body }, null, 2),
            maskAudit: cfg.piiMask
              ? auditOutgoing("reply", masker, logged)
              : undefined,
          });
        } catch (e) {
          send({ error: e instanceof Error ? e.message : "generation failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 500 },
    );
  }
}
