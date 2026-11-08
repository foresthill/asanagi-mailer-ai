import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { getAISettings } from "@/lib/store";
import type { AIProvider, AISettings } from "@/lib/types";

/**
 * Provider abstraction so the email AI can run on Claude, OpenAI, OpenRouter,
 * or the Vercel AI Gateway — switchable at runtime via in-app settings (BYOK)
 * or environment variables, without touching feature code.
 *
 * Resolution order (per field):
 *   provider: in-app setting (explicit) → AI_PROVIDER env → auto-detect from keys
 *   model:    in-app setting → AI_MODEL env → per-provider default
 *   apiKey:   in-app setting (per provider) → provider env var
 *
 * In-app settings are stored locally (see store.getAISettings); keys never
 * leave the device. Model ids change over time — set an exact current id.
 */
export type { AIProvider } from "@/lib/types";

const PROVIDERS: readonly AIProvider[] = ["anthropic", "openai", "openrouter", "gateway"];

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  openrouter: "anthropic/claude-sonnet-4.5",
  gateway: "anthropic/claude-sonnet-4.5",
};

/**
 * Suggested cheap models for high-volume judgments (朝の一凪 / 重要度判定).
 * Shown as a placeholder hint in 接続設定 — the user can edit/clear. Not
 * applied unless explicitly set, so it never silently changes behavior.
 */
export const CHEAP_MODELS: Record<AIProvider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  openrouter: "anthropic/claude-haiku-4.5",
  gateway: "anthropic/claude-haiku-4.5",
};

export interface AIConfig {
  provider: AIProvider;
  model: string;
  /** Model for 朝の一凪 / 重要度判定. Falls back to `model` when unset. */
  judgmentModel: string;
  apiKey?: string;
  /** Custom OpenAI-compatible endpoint for the `openai` provider (e.g. Ollama's
   *  /v1). Empty → provider default. Enables on-prem inference. */
  baseUrl?: string;
  configured: boolean;
  /** Where the active key/provider came from, for UI transparency. */
  source: "settings" | "env";
  /** 構造化PIIをAI送信前にマスクする（既定ON・lib/ai/pii.ts）。 */
  piiMask: boolean;
  /** 人名・社名もローカルNERでマスクする（実験的・既定OFF・lib/ai/ner.ts）。 */
  nerMask: boolean;
}

function envKey(p: AIProvider): string | undefined {
  switch (p) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY || undefined;
    case "openai":
      return process.env.OPENAI_API_KEY || undefined;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY || undefined;
    case "gateway":
      return process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || undefined;
  }
}

export function isProvider(v: string): v is AIProvider {
  return (PROVIDERS as readonly string[]).includes(v);
}

/** True when the active provider is an on-prem OpenAI-compatible endpoint. */
export function isOnprem(cfg: Pick<AIConfig, "provider" | "baseUrl">): boolean {
  return cfg.provider === "openai" && Boolean(cfg.baseUrl);
}

/** Human-facing endpoint label (no secrets): host for on-prem, provider otherwise. */
export function endpointLabel(cfg: Pick<AIConfig, "provider" | "baseUrl">): string {
  if (isOnprem(cfg) && cfg.baseUrl) {
    try {
      return new URL(cfg.baseUrl).host;
    } catch {
      return cfg.baseUrl;
    }
  }
  return cfg.provider;
}

/** Resolve the full AIConfig for one specific provider from the stored settings. */
function buildConfig(s: AISettings, provider: AIProvider, explicit: boolean): AIConfig {
  const storedKey = (p: AIProvider) => s.keys?.[p]?.trim() || undefined;
  const mergedKey = (p: AIProvider) => storedKey(p) ?? envKey(p);
  // Model is per-provider: models[provider] → legacy shared `model` → env → default.
  const model =
    s.models?.[provider]?.trim() ||
    s.model?.trim() ||
    process.env.AI_MODEL ||
    DEFAULT_MODELS[provider];
  const judgmentModel =
    s.judgmentModels?.[provider]?.trim() || s.judgmentModel?.trim() || model;
  const apiKey = mergedKey(provider);
  // baseUrl applies only to the openai provider (OpenAI-compatible endpoints).
  const baseUrl = provider === "openai" ? s.baseUrl?.trim() || undefined : undefined;
  const configured =
    provider === "gateway"
      ? Boolean(apiKey || process.env.VERCEL_OIDC_TOKEN)
      : Boolean(apiKey) || Boolean(baseUrl);
  const source: "settings" | "env" =
    storedKey(provider) ||
    explicit ||
    s.models?.[provider]?.trim() ||
    s.model?.trim() ||
    baseUrl
      ? "settings"
      : "env";
  return {
    provider,
    model,
    judgmentModel,
    apiKey,
    baseUrl,
    configured,
    source,
    piiMask: s.piiMask ?? true,
    nerMask: s.nerMask ?? false,
  };
}

/** Pick the active provider: explicit setting → AI_PROVIDER env → auto-detect. */
function pickProvider(s: AISettings): { provider: AIProvider; explicit: boolean } {
  const explicitSetting =
    s.provider && s.provider !== "auto" && isProvider(s.provider) ? s.provider : undefined;
  const envRaw = (process.env.AI_PROVIDER ?? "").toLowerCase();
  const explicitEnv = isProvider(envRaw) ? envRaw : undefined;
  if (explicitSetting) return { provider: explicitSetting, explicit: true };
  if (explicitEnv) return { provider: explicitEnv, explicit: true };
  const storedKey = (p: AIProvider) => s.keys?.[p]?.trim() || undefined;
  for (const p of PROVIDERS) if (storedKey(p) ?? envKey(p)) return { provider: p, explicit: false };
  return { provider: "anthropic", explicit: false };
}

/**
 * Resolve the active AI configuration from in-app settings, falling back to
 * environment variables. Async because settings are read from local storage.
 */
export async function loadAIConfig(): Promise<AIConfig> {
  const s = await getAISettings();
  const { provider, explicit } = pickProvider(s);
  return buildConfig(s, provider, explicit);
}

// --- On-prem reachability probe (shared with /api/ai/status), cached briefly ---
// Keeps the hot AI-call path from re-probing the tunnel on every request while
// still noticing a dropped/restored tunnel within a few seconds.
const REACH_TTL_MS = 15_000;
const reachCache = new Map<string, { ok: boolean; at: number }>();

export async function probeOnpremReachable(baseUrl: string, apiKey?: string): Promise<boolean> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const now = Date.now();
  const hit = reachCache.get(url);
  if (hit && now - hit.at < REACH_TTL_MS) return hit.ok;
  let ok = false;
  try {
    const res = await fetch(url, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(3500),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  reachCache.set(url, { ok, at: now });
  return ok;
}

export interface ActiveAIConfig extends AIConfig {
  /** True when the on-prem primary was unreachable and we switched to the cloud fallback. */
  fallbackActive: boolean;
  /** When fallbackActive, the on-prem primary we fell back FROM (for UI/logs). */
  primary?: { provider: AIProvider; model: string; endpoint: string };
}

/**
 * Like loadAIConfig, but applies the opt-in on-prem→cloud fallback. Feature
 * routes use THIS so a dropped SSH tunnel degrades to the user's chosen cloud
 * provider instead of failing — but ONLY when they opted in (settings
 * `fallbackProvider`). On fallback, PII masking is FORCED on (piiMask + nerMask),
 * because bodies that were meant to stay on the LAN would now reach the cloud.
 * When no fallback applies it is identical to loadAIConfig (fallbackActive:false).
 */
export async function loadActiveAIConfig(): Promise<ActiveAIConfig> {
  const s = await getAISettings();
  const primary = await loadAIConfig();
  const fb = s.fallbackProvider;
  const fbIsProvider =
    typeof fb === "string" && fb !== "none" && isProvider(fb) && fb !== "openai";

  if (isOnprem(primary) && fbIsProvider) {
    const fbCfg = buildConfig(s, fb as AIProvider, false);
    if (fbCfg.configured) {
      const reachable = await probeOnpremReachable(primary.baseUrl!, primary.apiKey);
      if (!reachable) {
        return {
          ...fbCfg,
          // Bodies now leave the LAN — never ship them unmasked.
          piiMask: true,
          nerMask: true,
          fallbackActive: true,
          primary: {
            provider: primary.provider,
            model: primary.model,
            endpoint: endpointLabel(primary),
          },
        };
      }
    }
  }

  return { ...primary, fallbackActive: false };
}

/** Build the language model for the given resolved config. */
export function resolveModel(cfg: AIConfig): LanguageModel {
  switch (cfg.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey })(cfg.model);
    case "openai":
      // A custom baseUrl targets any OpenAI-compatible server (e.g. Ollama's
      // /v1). A bare local Ollama needs no key, but the SDK wants a non-empty
      // apiKey, so fall back to a placeholder when a baseUrl is set. The
      // key.openai value, when present, is sent as the Bearer token (works with
      // a token-gating reverse proxy).
      return createOpenAI({
        apiKey: cfg.apiKey || (cfg.baseUrl ? "ollama" : undefined),
        baseURL: cfg.baseUrl,
      })(cfg.model);
    case "openrouter":
      return createOpenRouter({ apiKey: cfg.apiKey })(cfg.model);
    case "gateway":
      // The AI Gateway accepts plain "provider/model" strings (key via env/OIDC).
      return cfg.model;
  }
}

export function modelLabel(cfg: AIConfig): string {
  return `${cfg.provider}:${cfg.model}`;
}
