import { NextResponse } from "next/server";
import { loadAIConfig } from "@/lib/ai/model";

export const dynamic = "force-dynamic";

/**
 * Lightweight, always-pollable snapshot of the active AI connection for the
 * persistent status chip (sidebar). Reports what loadAIConfig resolves, plus a
 * FREE reachability probe for on-prem endpoints only:
 *   - on-prem (provider "openai" + baseUrl, e.g. an Ollama behind an SSH tunnel):
 *     GET {baseUrl}/models — no token spent, fast timeout. This is what detects a
 *     dropped tunnel (reachable: false).
 *   - cloud (anthropic / openrouter / gateway): there is no free liveness check
 *     (a real request costs a token), so we only report whether a key is set and
 *     never ping them here — reachable is null (= "configured, not live-checked").
 * local-first: the probe only ever reaches the user's own endpoint. Never
 * returns the API key.
 */
export async function GET() {
  const cfg = await loadAIConfig();
  const isOnprem = cfg.provider === "openai" && Boolean(cfg.baseUrl);

  // Human-facing endpoint label (no secrets): host for on-prem, provider name otherwise.
  let endpoint: string = cfg.provider;
  if (isOnprem && cfg.baseUrl) {
    try {
      endpoint = new URL(cfg.baseUrl).host; // e.g. localhost:11435
    } catch {
      endpoint = cfg.baseUrl;
    }
  }

  const base = {
    provider: cfg.provider,
    model: cfg.model,
    judgmentModel: cfg.judgmentModel === cfg.model ? null : cfg.judgmentModel,
    source: cfg.source,
    configured: cfg.configured,
    kind: isOnprem ? ("onprem" as const) : ("cloud" as const),
    endpoint,
  };

  if (!cfg.configured) {
    return NextResponse.json({ ...base, reachable: false, modelCount: null });
  }

  if (!isOnprem) {
    // Cloud: configured but intentionally not live-pinged (would cost a token).
    return NextResponse.json({ ...base, reachable: null, modelCount: null });
  }

  // On-prem: free liveness probe against the OpenAI-compatible /models endpoint
  // (same contract as /api/settings/ai/models). A dead tunnel fails fast here.
  const url = `${cfg.baseUrl!.replace(/\/+$/, "")}/models`;
  try {
    const res = await fetch(url, {
      headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return NextResponse.json({
        ...base,
        reachable: false,
        modelCount: null,
        error: `HTTP ${res.status}`,
      });
    }
    const json = (await res.json()) as { data?: { id?: string }[] };
    const ids = (json.data ?? [])
      .map((m) => m.id)
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    return NextResponse.json({
      ...base,
      reachable: true,
      modelCount: ids.length,
      // Warn when the active model isn't actually served (renamed / not pulled).
      modelMissing: cfg.model ? !ids.includes(cfg.model) : false,
    });
  } catch (e) {
    const timedOut =
      e instanceof Error && (e.name === "TimeoutError" || /timeout/i.test(e.message));
    return NextResponse.json({
      ...base,
      reachable: false,
      modelCount: null,
      error: timedOut ? "timeout" : e instanceof Error ? e.message : "unreachable",
    });
  }
}
