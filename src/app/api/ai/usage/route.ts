import { NextResponse } from "next/server";
import { aiUsageStats } from "@/lib/db";
import { estimateUsd, openRouterPrices } from "@/lib/ai/pricing";

export const dynamic = "force-dynamic";

/** Local AI usage log (cost transparency): tokens in/out + USD estimate. */
export async function GET() {
  const stats = aiUsageStats();

  // Best-effort cost estimate — tokens stay authoritative if pricing fails.
  let totalEstUsd: number | null = null;
  let byModel: (typeof stats.byModel[number] & { estUsd?: number })[] = stats.byModel;
  let byKind: (typeof stats.byKind[number] & { estUsd?: number })[] = stats.byKind;

  // 日次集計（トークンは常に、USDは価格取得できたときのみ）。日ごとに複数モデルを合算。
  const dailyMap = new Map<
    string,
    { day: string; calls: number; inputTokens: number; outputTokens: number; estUsd: number | null }
  >();
  for (const dm of stats.byDayModel) {
    const cur =
      dailyMap.get(dm.day) ??
      { day: dm.day, calls: 0, inputTokens: 0, outputTokens: 0, estUsd: null };
    cur.calls += dm.calls;
    cur.inputTokens += dm.inputTokens;
    cur.outputTokens += dm.outputTokens;
    dailyMap.set(dm.day, cur);
  }

  try {
    const prices = await openRouterPrices();
    const cost = (inTok: number, outTok: number, model: string) =>
      estimateUsd(prices, model, inTok, outTok);
    let sum = 0;
    let any = false;
    byModel = stats.byModel.map((m) => {
      const estUsd = cost(m.inputTokens, m.outputTokens, m.model);
      if (estUsd == null) return m;
      sum += estUsd;
      any = true;
      return { ...m, estUsd };
    });
    if (any) totalEstUsd = sum;

    // Per-kind USD: sum each (kind × model) priced separately, since pricing
    // is per model. Lets the UI show e.g. "朝の一凪 ≈ $0.34".
    const kindUsd = new Map<string, number>();
    const kindPriced = new Set<string>();
    for (const km of stats.byKindModel) {
      const estUsd = cost(km.inputTokens, km.outputTokens, km.model);
      if (estUsd == null) continue;
      kindUsd.set(km.kind, (kindUsd.get(km.kind) ?? 0) + estUsd);
      kindPriced.add(km.kind);
    }
    byKind = stats.byKind.map((k) =>
      kindPriced.has(k.kind) ? { ...k, estUsd: kindUsd.get(k.kind) } : k,
    );

    // 日次USD: (日×モデル)を価格付けして日ごとに合算。
    for (const dm of stats.byDayModel) {
      const c = cost(dm.inputTokens, dm.outputTokens, dm.model);
      if (c == null) continue;
      const cur = dailyMap.get(dm.day);
      if (cur) cur.estUsd = (cur.estUsd ?? 0) + c;
    }
  } catch {
    /* offline or API change — show tokens only */
  }

  const daily = [...dailyMap.values()].sort((a, b) => a.day.localeCompare(b.day));

  return NextResponse.json({
    ...stats,
    byModel,
    byKind,
    daily,
    totalEstUsd,
    pricingSource: "openrouter",
  });
}
