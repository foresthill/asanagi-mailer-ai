import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadActiveAIConfig, resolveModel } from "@/lib/ai/model";
import { WRITING_RULE_SYSTEM } from "@/lib/ai/prompts";
import { logAiUsage } from "@/lib/db";
import { PiiMasker } from "@/lib/ai/pii";

export const maxDuration = 30;

const ruleSchema = z.object({ rule: z.string() });

/**
 * 返信文体の昇格(B): AI案とユーザー最終の差から「文体ルール」を1行提案する。
 * これはユーザーが明示的に押したときだけ動く on-demand pull（自動抽出・自動
 * 上書きはしない）。提案はUIで編集・承認してから writing-note に追記される。
 * local-first: 入力(ai/final)は本文を含むため、他AIルートと同じく構造化PIIを
 * 可逆マスクしてから送る（関所）。返すルールは一般則なので固有名詞を含まない。
 */
export async function POST(req: Request) {
  const { ai, final } = (await req.json().catch(() => ({}))) as {
    ai?: string;
    final?: string;
  };
  if (!ai?.trim() || !final?.trim()) {
    return NextResponse.json({ rule: "", ai: false });
  }

  const cfg = await loadActiveAIConfig();
  // AI未設定/未接続でも昇格UIは手書きで使えるよう、提案は空で返す（UI側で
  // ユーザーが自分のルールを書ける）。
  if (!cfg.configured) return NextResponse.json({ rule: "", ai: false });

  try {
    const masker = new PiiMasker();
    const pAi = cfg.piiMask ? masker.mask(ai) : ai;
    const pFinal = cfg.piiMask ? masker.mask(final) : final;
    const prompt = ["--- AI案 ---", pAi, "", "--- ユーザー最終 ---", pFinal].join("\n");
    const { object, usage } = await generateObject({
      model: resolveModel(cfg),
      maxOutputTokens: 120,
      schema: ruleSchema,
      system: WRITING_RULE_SYSTEM,
      prompt,
    });
    logAiUsage("writing-rule", cfg.model, usage?.inputTokens, usage?.outputTokens);
    // The rule is a generic style note; unmask in case a token slipped through.
    return NextResponse.json({ rule: masker.unmask(object.rule).trim(), ai: true });
  } catch (err) {
    // Suggestion is best-effort — the UI falls back to a free-text rule box.
    return NextResponse.json(
      { rule: "", ai: false, error: err instanceof Error ? err.message : "failed" },
      { status: 200 },
    );
  }
}
