import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { emailContext } from "@/lib/ai/prompts";
import { logAiUsage } from "@/lib/db";
import { PiiMasker } from "@/lib/ai/pii";
import type { Email } from "@/lib/types";

/**
 * 失礼チェック（レビュー型添削）。書き換えずに、相手に失礼/不適切/誤解を招く箇所を
 * 指摘し、「なぜ直すべきか（修正の意図）」をコメントで返す。POST { draft, email?,
 * subject? } → { ok, overall, issues:[{quote, comment}] }。構造化PIIはマスクして送る。
 */

export const maxDuration = 30;

const schema = z.object({
  ok: z
    .boolean()
    .describe("失礼・不適切な点が無く概ね問題なければ true、直すべき点があれば false"),
  overall: z
    .string()
    .describe("全体評価を1〜2文で（失礼な点の有無・相手に与える印象）"),
  issues: z
    .array(
      z.object({
        quote: z
          .string()
          .describe("問題のある箇所（下書きからの短い引用）。全体的な指摘なら空文字"),
        comment: z
          .string()
          .describe("何がなぜ問題か＝修正の意図を、具体的かつ丁寧に。直し方の例も可"),
      }),
    )
    .describe("指摘のリスト（問題が無ければ空配列）"),
});

export async function POST(req: Request) {
  const { draft, email, subject } = (await req.json()) as {
    draft?: string;
    email?: Email;
    subject?: string;
  };
  if (!draft?.trim()) {
    return NextResponse.json({ error: "draft required" }, { status: 400 });
  }
  const cfg = await loadAIConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: "AIキーが未設定です（設定から接続してください）" },
      { status: 400 },
    );
  }

  try {
    const masker = new PiiMasker();
    const md = cfg.piiMask ? masker.mask(draft) : draft;
    const me = cfg.piiMask && email ? masker.maskEmail(email) : email;
    const system =
      "あなたは日本のビジネスメールのレビュアーです。渡された下書きが、相手に失礼・" +
      "不適切・誤解を招く表現になっていないかを点検します。あなたは書き換えません。" +
      "問題箇所の短い引用と「なぜ直すべきか（修正の意図）」をコメントで示します。" +
      "敬語の誤り・クッション言葉の不足・依頼/断り/催促/謝罪のトーン・上から目線・" +
      "曖昧で誤解を招く表現を重視。問題が無ければ ok=true、issues は空配列に。" +
      "重箱の隅をつつく過剰な指摘はせず、相手に実害のある点に絞る。";
    const prompt = [
      "次のメール下書きを点検してください。",
      me ? `--- 返信対象の元メール（文脈） ---\n${emailContext(me)}` : "",
      subject ? `件名: ${subject}` : "",
      "--- 下書き ---",
      md,
    ]
      .filter(Boolean)
      .join("\n\n");

    const { object, usage } = await generateObject({
      model: resolveModel(cfg),
      maxOutputTokens: 1500,
      schema,
      system,
      prompt,
    });
    logAiUsage("review", cfg.model, usage?.inputTokens, usage?.outputTokens, {
      prompt: `[system]\n${system}\n\n[prompt]\n${prompt}`,
      response: JSON.stringify(object, null, 2),
    });
    return NextResponse.json({
      ok: object.ok,
      overall: masker.unmask(object.overall),
      issues: object.issues.map((i) => ({
        quote: masker.unmask(i.quote),
        comment: masker.unmask(i.comment),
      })),
      ai: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "review failed" },
      { status: 500 },
    );
  }
}
