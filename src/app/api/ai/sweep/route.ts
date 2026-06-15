import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { SWEEP_SYSTEM } from "@/lib/ai/prompts";
import { PiiMasker } from "@/lib/ai/pii";
import { logAiUsage } from "@/lib/db";
import { getSweptIds, guessFromSignals, listSignals } from "@/lib/store";
import { heuristicImportance } from "@/lib/importance";
import type { Email } from "@/lib/types";

export const maxDuration = 60;

export type SweepAction = "keep" | "archive" | "trash";

export interface SweepItem {
  id: string;
  action: SweepAction;
  reason: string;
  source: "learned" | "heuristic" | "ai";
}

const schema = z.object({
  items: z.array(
    z.object({
      index: z.number(),
      action: z.enum(["keep", "archive", "trash"]),
      reason: z.string(),
    }),
  ),
});

/**
 * 朝の一掃: 受信箱のメールを「差出人・件名・プレビューだけ」で安価に
 * 一括判定し、archive / trash 推奨リストを返す（本文は送らない＝コスト減
 * ＆プライバシー減）。学習済みシグナルがある送信者はAIを呼ばず即断。
 * 迷ったら keep（誤って人のメールを片付けない）。
 */
/** Free keyword fallback row (no AI cost). */
function heuristicItem(e: Email): SweepItem {
  const imp = heuristicImportance(e);
  return {
    id: e.id,
    action: imp === "low" ? "archive" : "keep",
    reason: imp === "low" ? "簡易判定: 低" : "簡易判定",
    source: "heuristic",
  };
}

export async function POST(req: Request) {
  const { emails } = (await req.json()) as { emails: Email[] };
  if (!emails?.length) return NextResponse.json({ items: [] });

  // 判断済み（前回さばいた）メールは除外 — 再判定しない＝再提示しない＆コスト減。
  const swept = await getSweptIds();
  const fresh = emails.filter((e) => !swept.has(e.id));
  if (!fresh.length) return NextResponse.json({ items: [], allReviewed: true });

  const signals = await listSignals();
  const items: SweepItem[] = [];
  const undecided: Email[] = [];

  for (const e of fresh.slice(0, 100)) {
    const learned = guessFromSignals(e.from.email, signals);
    if (learned === "low") {
      items.push({ id: e.id, action: "archive", reason: "学習済み: 低", source: "learned" });
    } else if (learned) {
      items.push({ id: e.id, action: "keep", reason: "学習済みの相手", source: "learned" });
    } else {
      undecided.push(e);
    }
  }

  const cfg = await loadAIConfig();
  if (!cfg.configured || undecided.length === 0) {
    // No AI key → keyword heuristic only (free).
    for (const e of undecided) items.push(heuristicItem(e));
    return NextResponse.json({ items, ai: cfg.configured });
  }

  try {
    // One batched call for everything unknown — from/subject/preview only.
    const masker = new PiiMasker();
    const lines = undecided.map((e, i) => {
      const from = `${e.from.name ?? ""} <${e.from.email}>`.trim();
      const subject = cfg.piiMask ? masker.mask(e.subject) : e.subject;
      const preview = (cfg.piiMask ? masker.mask(e.snippet) : e.snippet).slice(0, 140);
      return `${i}. From: ${from}\n   件名: ${subject}\n   冒頭: ${preview}`;
    });
    const { object, usage } = await generateObject({
      model: resolveModel(cfg),
      // Explicit output budget: without it some providers reserve the model max
      // (64k) and fail the affordability check when credits run low.
      maxOutputTokens: 4000,
      schema,
      system: SWEEP_SYSTEM,
      prompt: [
        `以下の${undecided.length}通について、index ごとに action と reason を返してください。`,
        "",
        ...lines,
      ].join("\n"),
    });
    logAiUsage("sweep", cfg.model, usage?.inputTokens, usage?.outputTokens);

    const byIndex = new Map(object.items.map((r) => [r.index, r]));
    undecided.forEach((e, i) => {
      const r = byIndex.get(i);
      items.push({
        id: e.id,
        action: r?.action ?? "keep", // 返答漏れは keep に倒す
        reason: masker.unmask(r?.reason ?? ""),
        source: "ai",
      });
    });
    return NextResponse.json({ items, ai: true });
  } catch (err) {
    // AI失敗（クレジット切れ等）でも止めない: 無料のキーワード判定で続行する。
    // 全体を500で落とすと「朝の一掃」自体が使えなくなるため。
    for (const e of undecided) items.push(heuristicItem(e));
    return NextResponse.json({
      items,
      ai: false,
      warning: `AI判定は使えませんでした（${
        err instanceof Error ? err.message : "失敗"
      }）。簡易判定（無料）で表示しています。`,
    });
  }
}
