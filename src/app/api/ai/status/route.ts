import { NextResponse } from "next/server";
import {
  endpointLabel,
  isOnprem,
  isProvider,
  loadAIConfig,
  loadActiveAIConfig,
  probeOnpremModels,
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
  // On-prem only: whether the CONFIGURED model id is actually served by the
  // endpoint (null = can't tell: cloud, or unreachable), plus the live list so
  // the UI can offer "合わせる" (switch to an installed model).
  let modelAvailable: boolean | null = null;
  let availableModels: string[] = [];
  if (!primary.configured) {
    reachable = false;
  } else if (onprem) {
    const probe = await probeOnpremModels(primary.baseUrl!, primary.apiKey);
    reachable = probe.reachable;
    availableModels = probe.models;
    modelAvailable = probe.reachable ? probe.models.includes(primary.model) : null;
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
    // On-prem: is the configured model actually installed? (null when unknown.)
    modelAvailable,
    // On-prem: model ids the endpoint serves right now ("合わせる" picker source).
    availableModels,
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
