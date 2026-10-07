import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import {
  CLASSIFY_SYSTEM,
  classifyContext,
  profileBlock,
  langDirective,
} from "@/lib/ai/prompts";
import {
  getAISettings,
  getJudgmentProfile,
  listSignals,
  listThreatSenders,
  listSafeSenders,
} from "@/lib/store";
import { detectThreat } from "@/lib/threat";
import { isJevEnabled, jevClassify, jevEndpointOf } from "@/lib/ai/jev";
import { PiiMasker } from "@/lib/ai/pii";
import type { Email } from "@/lib/types";

/**
 * Jev プレイグラウンド（比較）: 同じメール1通を、現行の LLM 判定（Claude 等）と Jev
 * （System One）で**同時に**判定し、重要度・脅威・確信度・所要時間を返す。威力を
 * 「見て分かる」ための sandbox なので、ここでは教師ログ（judgments）や使用量ログには
 * 記録しない（本番の学習・コスト集計を汚さない）。PII は本番と同じくマスクして送る。
 */

export const maxDuration = 45;

const schema = z.object({
  importance: z.enum(["high", "normal", "low"]),
  reason: z.string(),
  threat: z.enum(["none", "spam", "phishing"]).default("none"),
});

function resolveThreat(
  aiThreat: "spam" | "phishing" | undefined,
  heuristic: "spam" | "phishing" | undefined,
  isSafe: boolean,
): "spam" | "phishing" | undefined {
  if (isSafe) return undefined;
  if (aiThreat === "phishing") return heuristic;
  return aiThreat ?? heuristic;
}

export async function POST(req: Request) {
  const { email, locale } = (await req.json()) as {
    email: Email;
    locale?: string;
  };
  if (!email?.from?.email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const [cfg, ai, signals, threatSenders, safeSenders, profile] =
    await Promise.all([
      loadAIConfig(),
      getAISettings(),
      listSignals(),
      listThreatSenders(),
      listSafeSenders(),
      getJudgmentProfile(),
    ]);

  const addr = email.from.email.toLowerCase();
  const domain = addr.split("@")[1] ?? "";
  const isSafe =
    safeSenders.senders.has(addr) || safeSenders.domains.has(domain);
  const heuristicThreat = detectThreat(email, threatSenders, safeSenders);

  // ── LLM 側（現行の重要度判定モデル＝Claude 等） ───────────────────────────
  const llmRun = (async () => {
    const t0 = Date.now();
    try {
      if (!cfg.configured) {
        return { error: "AIキー未設定", ms: Date.now() - t0 } as const;
      }
      const masker = new PiiMasker();
      const target = cfg.piiMask ? masker.maskEmail(email) : email;
      const prompt =
        classifyContext(target, signals, cfg.piiMask ? masker : undefined) +
        profileBlock(profile);
      const system = CLASSIFY_SYSTEM + langDirective(locale);
      const { object } = await generateObject({
        model: resolveModel({ ...cfg, model: cfg.judgmentModel }),
        maxOutputTokens: 300,
        schema,
        system,
        prompt,
      });
      const aiThreat = object.threat === "none" ? undefined : object.threat;
      return {
        importance: object.importance,
        reason: masker.unmask(object.reason),
        threat: resolveThreat(aiThreat, heuristicThreat, isSafe) ?? null,
        model: cfg.judgmentModel,
        ms: Date.now() - t0,
      } as const;
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "LLM 判定に失敗",
        ms: Date.now() - t0,
      } as const;
    }
  })();

  // ── Jev 側（System One・型付き＋確信度） ─────────────────────────────────
  const jevRun = (async () => {
    const endpoint = jevEndpointOf(ai);
    if (!isJevEnabled(ai)) {
      return { disabled: true as const, endpoint };
    }
    const t0 = Date.now();
    try {
      const masker = new PiiMasker();
      const mask = (s?: string) =>
        cfg.piiMask && s ? masker.mask(s) : (s ?? "");
      const res = await jevClassify(ai, {
        subject: mask(email.subject),
        from: `${email.from.name ?? ""} <${mask(email.from.email)}>`.trim(),
        body: mask(email.body || email.snippet),
      });
      return {
        importance: res.importance,
        threat: resolveThreat(res.threat, heuristicThreat, isSafe) ?? null,
        confidence: res.importanceConfidence,
        endpoint,
        ms: Date.now() - t0,
      } as const;
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "Jev 判定に失敗",
        endpoint,
        ms: Date.now() - t0,
      } as const;
    }
  })();

  const [llm, jev] = await Promise.all([llmRun, jevRun]);
  return NextResponse.json({ llm, jev });
}
