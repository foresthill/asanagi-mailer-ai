import { NextResponse } from "next/server";
import { aiUsageStats } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * OpenRouter's public model list carries per-token USD prices — real
 * published rates, not guesses (https://openrouter.ai/api/v1/models).
 * Cached in-process for an hour; mail content never leaves the device
 * (this request carries no user data, not even the API key).
 */
let priceCache: { at: number; prices: Map<string, { prompt: number; completion: number }> } | null =
  null;

async function openRouterPrices(): Promise<Map<string, { prompt: number; completion: number }>> {
  if (priceCache && Date.now() - priceCache.at < 3600_000) return priceCache.prices;
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`pricing fetch failed: ${res.status}`);
  const data = (await res.json()) as {
    data?: { id: string; pricing?: { prompt?: string; completion?: string } }[];
  };
  const prices = new Map<string, { prompt: number; completion: number }>();
  for (const m of data.data ?? []) {
    const prompt = Number(m.pricing?.prompt);
    const completion = Number(m.pricing?.completion);
    if (Number.isFinite(prompt) && Number.isFinite(completion)) {
      prices.set(m.id, { prompt, completion });
    }
  }
  priceCache = { at: Date.now(), prices };
  return prices;
}

/** Local AI usage log (cost transparency): tokens in/out + USD estimate. */
export async function GET() {
  const stats = aiUsageStats();

  // Best-effort cost estimate — tokens stay authoritative if pricing fails.
  let totalEstUsd: number | null = null;
  let byModel: (typeof stats.byModel[number] & { estUsd?: number })[] = stats.byModel;
  try {
    const prices = await openRouterPrices();
    let sum = 0;
    let any = false;
    byModel = stats.byModel.map((m) => {
      const p = prices.get(m.model);
      if (!p) return m;
      const estUsd = m.inputTokens * p.prompt + m.outputTokens * p.completion;
      sum += estUsd;
      any = true;
      return { ...m, estUsd };
    });
    if (any) totalEstUsd = sum;
  } catch {
    /* offline or API change — show tokens only */
  }

  return NextResponse.json({ ...stats, byModel, totalEstUsd, pricingSource: "openrouter" });
}
