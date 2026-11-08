import { NextResponse } from "next/server";
import {
  endpointLabel,
  isOnprem,
  isProvider,
  loadAIConfig,
  loadActiveAIConfig,
  probeOnpremReachable,
} from "@/lib/ai/model";
import { getAISettings } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Lightweight, always-pollable snapshot of the active AI connection for the
 * persistent status chip (sidebar). Reports the configured primary provider,
 * plus a FREE reachability probe for on-prem endpoints only (cloud providers are
 * never pinged — a real request would cost a token — so reachable is null there),
 * plus the opt-in on-prem→cloud fallback state so the chip can warn when bodies
 * are currently going to the cloud. local-first: the probe only reaches the
 * user's own endpoint. Never returns the API key.
 */
export async function GET() {
  const primary = await loadAIConfig();
  const onprem = isOnprem(primary);

  const s = await getAISettings();
  const fbRaw = s.fallbackProvider;
  const fbProvider =
    typeof fbRaw === "string" && fbRaw !== "none" && isProvider(fbRaw) && fbRaw !== "openai"
      ? fbRaw
      : null;

  let reachable: boolean | null = null;
  if (!primary.configured) {
    reachable = false;
  } else if (onprem) {
    reachable = await probeOnpremReachable(primary.baseUrl!, primary.apiKey);
  } // else cloud: leave null (not live-pinged)

  // Only resolve the active (possibly fallen-back) config when it could matter:
  // on-prem primary that is configured. Re-uses the cached probe above.
  const active = onprem && primary.configured ? await loadActiveAIConfig() : null;
  const fallbackActive = Boolean(active?.fallbackActive);

  return NextResponse.json({
    provider: primary.provider,
    model: primary.model,
    judgmentModel:
      primary.judgmentModel === primary.model ? null : primary.judgmentModel,
    source: primary.source,
    configured: primary.configured,
    kind: onprem ? ("onprem" as const) : ("cloud" as const),
    endpoint: endpointLabel(primary),
    reachable,
    // Configured standby fallback (on-prem only). null when not set / not applicable.
    fallback: fbProvider ? { provider: fbProvider } : null,
    // True when the tunnel is down AND the fallback is actually serving now.
    fallbackActive,
    // What is actually answering while fallbackActive (the cloud provider/model).
    serving:
      fallbackActive && active
        ? { provider: active.provider, model: active.model }
        : null,
  });
}
