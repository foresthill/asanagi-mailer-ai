import { NextResponse } from "next/server";
import { aiLogEntries } from "@/lib/db";
import { estimateUsd, openRouterPrices } from "@/lib/ai/pricing";

export const dynamic = "force-dynamic";

/**
 * AIログ: every AI call this device made, newest first — with the actual
 * (PII-masked) prompt that left the device, the reply, tokens, and a USD
 * estimate. Pure transparency; nothing is sent anywhere by this endpoint.
 */
export async function GET(req: Request) {
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 100, 500);
  const entries = aiLogEntries(limit);

  let withCost: (typeof entries[number] & { estUsd?: number })[] = entries;
  try {
    const prices = await openRouterPrices();
    withCost = entries.map((e) => {
      const estUsd = estimateUsd(prices, e.model, e.inputTokens ?? 0, e.outputTokens ?? 0);
      return estUsd == null ? e : { ...e, estUsd };
    });
  } catch {
    /* offline — tokens stay authoritative */
  }

  return NextResponse.json({ entries: withCost });
}
