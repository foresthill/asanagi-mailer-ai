import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { SIGNATURE_SYSTEM } from "@/lib/ai/prompts";
import { PiiMasker, auditOutgoing } from "@/lib/ai/pii";
import { logAiUsage } from "@/lib/db";

export const maxDuration = 60;

/**
 * 署名から会社名を「コピー抽出」する（推測禁止）。連絡先メタの候補として使い、
 * ユーザーが確認して保存する（自動保存はしない）。前株/後株は署名の表記のまま。
 *
 * PII マスク: 構造化PII（メール/電話等）はマスクして送るが、NER（人名・社名の
 * マスク）は適用しない — 会社名を隠すと抽出できないため。出力は unmask する。
 */
const schema = z.object({
  company: z
    .string()
    .nullable()
    .describe("署名に書かれた会社・組織名をそのまま。無ければ null"),
});

const MAX_BODY = 4000;

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  const body = (text ?? "").trim();
  if (!body) {
    return NextResponse.json({ error: "本文が空です" }, { status: 400 });
  }

  const cfg = await loadAIConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: "AIが未設定です（接続設定から設定してください）" },
      { status: 400 },
    );
  }

  try {
    // Structured PII only (mask emails/phones). Do NOT learn/mask entities (NER),
    // otherwise the company name would be hidden and unextractable.
    const masker = new PiiMasker();
    const masked = cfg.piiMask
      ? masker.mask(body.slice(0, MAX_BODY))
      : body.slice(0, MAX_BODY);

    const prompt = [
      "以下はメール本文です（末尾に署名が含まれることがあります）。差出人の会社・組織名だけを、署名のとおりにコピーしてください。無ければ null。",
      "",
      masked,
    ].join("\n");

    // 判定用モデルで十分（軽い抽出）。未設定ならメインと同じ。
    const { object, usage } = await generateObject({
      model: resolveModel({ ...cfg, model: cfg.judgmentModel }),
      maxOutputTokens: 200,
      schema,
      system: SIGNATURE_SYSTEM,
      prompt,
    });

    // Unmask in case a token slipped in; then reject any residual mask token
    // (never surface a placeholder like [EMAIL_1] as a company name).
    const raw = object.company ? masker.unmask(object.company).trim() : "";
    const company = raw && !/\[[A-Z]+_\d+\]/.test(raw) ? raw : null;

    const logged = `[system]\n${SIGNATURE_SYSTEM}\n\n[prompt]\n${prompt}`;
    logAiUsage(
      "signature",
      cfg.judgmentModel,
      usage?.inputTokens,
      usage?.outputTokens,
      {
        prompt: logged,
        response: JSON.stringify({ company }, null, 2),
        maskAudit: cfg.piiMask
          ? auditOutgoing("signature", masker, logged)
          : undefined,
      },
    );

    return NextResponse.json({ company });
  } catch (err) {
    console.warn(
      "[extract-signature] AI失敗:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "会社名の抽出に失敗しました" },
      { status: 500 },
    );
  }
}
