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
  getJudgmentProfile,
  guessFromSignals,
  listSignals,
  listThreatSenders,
  listSafeSenders,
} from "@/lib/store";
import { heuristicImportance, projectKeyFromSubject } from "@/lib/importance";
import { detectThreat } from "@/lib/threat";
import { PiiMasker, auditOutgoing } from "@/lib/ai/pii";
import { logAiUsage, logJudgment } from "@/lib/db";
import type { Email, Importance } from "@/lib/types";

export const maxDuration = 30;

const schema = z.object({
  importance: z.enum(["high", "normal", "low"]),
  reason: z.string(),
  // 危険メールは重要度とは別軸。none/spam/phishing。
  threat: z.enum(["none", "spam", "phishing"]).default("none"),
});

/** Persist every judgment — the supervised-learning log (仕分けレビュー). */
function record(
  email: Email,
  importance: Importance,
  reason: string,
  source: string,
) {
  try {
    logJudgment({
      account: email.account ?? "unknown",
      emailId: email.id,
      subject: email.subject,
      fromName: email.from.name,
      fromEmail: email.from.email,
      importance,
      reason,
      source,
    });
  } catch {
    /* logging must never break classification */
  }
}

export async function POST(req: Request) {
  const { email, locale } = (await req.json()) as {
    email: Email;
    locale?: string;
  };
  const signals = await listSignals();
  // Dangerous-mail flag (phishing/spam) — independent of importance, always
  // applied so a "learned low" or heuristic result still carries the warning.
  const safeSenders = await listSafeSenders();
  const threat = detectThreat(email, await listThreatSenders(), safeSenders);
  // 「問題無し」で安全登録された差出人は、AIが phishing と判定しても警告しない
  // （＝問題無しが恒久化する）。誤検知の恒久的な打ち消し。
  const addr = email.from.email.toLowerCase();
  const domain = addr.split("@")[1] ?? "";
  const isSafe =
    safeSenders.senders.has(addr) || safeSenders.domains.has(domain);

  // Heuristic short-circuit: if the user has already taught us about this
  // sender/domain, trust that immediately (fast + free + personalized).
  const learned = guessFromSignals(
    email.from.email,
    signals,
    projectKeyFromSubject(email.subject),
  );
  if (learned) {
    const reason = "あなたの過去の判断（学習済み）に基づく判定です。";
    record(email, learned, reason, "learned");
    return NextResponse.json({
      importance: learned,
      reason,
      source: "learned",
      threat,
    });
  }

  const cfg = await loadAIConfig();
  if (!cfg.configured) {
    // Keyword fallback (shared with the list annotator) so the UI still works.
    const importance = heuristicImportance(email);
    const reason = "キーワードに基づく簡易判定です（AIキー未設定）。";
    record(email, importance, reason, "heuristic");
    return NextResponse.json({
      importance,
      reason,
      source: "heuristic",
      threat,
    });
  }

  try {
    // 構造化PIIはローカルでトークン化してから送る（lib/ai/pii.ts）。
    const masker = new PiiMasker();
    if (cfg.piiMask && cfg.nerMask) {
      await masker.learnEntities([
        email.subject,
        email.body,
        email.from.name,
        ...(email.to?.map((t) => t.name) ?? []),
      ]);
    }
    const target = cfg.piiMask ? masker.maskEmail(email) : email;
    // 嗜好メモ（ユーザー自筆の指示）はマスクせず素のまま注入する。
    const profile = await getJudgmentProfile();
    const prompt =
      classifyContext(target, signals, cfg.piiMask ? masker : undefined) +
      profileBlock(profile);
    const system = CLASSIFY_SYSTEM + langDirective(locale);
    const { object, usage } = await generateObject({
      // 重要度判定は安価な判定用モデルで（未設定ならメインと同じ）。
      model: resolveModel({ ...cfg, model: cfg.judgmentModel }),
      // Explicit output budget: without it some providers reserve the model max
      // (64k) and fail the affordability check when credits run low.
      maxOutputTokens: 300,
      schema,
      system,
      prompt,
    });
    record(email, object.importance, object.reason, "ai");
    const logged = `[system]\n${system}\n\n[prompt]\n${prompt}`;
    logAiUsage(
      "classify",
      cfg.judgmentModel,
      usage?.inputTokens,
      usage?.outputTokens,
      {
        prompt: logged,
        response: JSON.stringify(object, null, 2),
        maskAudit: cfg.piiMask
          ? auditOutgoing("classify", masker, logged)
          : undefined,
      },
    );
    // Threat の最終判定（誤検知を構造的に抑える）:
    // 1. safe 登録済み（問題無し）は常に警告しない＝問題無しが恒久化する。
    // 2. AI 単独の "phishing" は業務メール（見積・発注・請求・定型免責文）で誤検知
    //    しやすいので採用しない。phishing はヒューリスティック（なりすまし＋差出人
    //    ドメイン不一致＝高精度）が検出したときのみ。
    // 3. AI の "spam"（害の小さい宣伝・勧誘）は AI 単独でも採用する。
    const aiThreat = object.threat === "none" ? undefined : object.threat;
    let finalThreat: "spam" | "phishing" | undefined;
    if (isSafe) {
      finalThreat = undefined;
    } else if (aiThreat === "phishing") {
      // AI 単独の phishing は不採用。ヒューリスティックの結果に委ねる。
      finalThreat = threat;
    } else {
      finalThreat = aiThreat ?? threat;
    }
    return NextResponse.json({
      importance: object.importance,
      reason: masker.unmask(object.reason),
      source: "ai",
      threat: finalThreat,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "classify failed" },
      { status: 500 },
    );
  }
}
