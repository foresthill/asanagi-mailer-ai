/**
 * OpenRouter publishes per-token USD prices for most models
 * (https://openrouter.ai/api/v1/models) — real rates, not guesses. We use
 * them only to *estimate* local usage cost; no user data is sent (this fetch
 * carries no key and no mail content). Cached in-process for an hour.
 */
type Price = { prompt: number; completion: number };

let cache: { at: number; prices: Map<string, Price> } | null = null;

export async function openRouterPrices(): Promise<Map<string, Price>> {
  // Date.now() is fine here (server runtime, not a workflow script).
  if (cache && Date.now() - cache.at < 3600_000) return cache.prices;
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`pricing fetch failed: ${res.status}`);
  const data = (await res.json()) as {
    data?: { id: string; pricing?: { prompt?: string; completion?: string } }[];
  };
  const prices = new Map<string, Price>();
  for (const m of data.data ?? []) {
    const prompt = Number(m.pricing?.prompt);
    const completion = Number(m.pricing?.completion);
    if (Number.isFinite(prompt) && Number.isFinite(completion)) {
      prices.set(m.id, { prompt, completion });
    }
  }
  cache = { at: Date.now(), prices };
  return prices;
}

/** USD estimate for one call, or null if the model isn't in the price list. */
export function estimateUsd(
  prices: Map<string, Price>,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const p = prices.get(model);
  return p ? inputTokens * p.prompt + outputTokens * p.completion : null;
}
