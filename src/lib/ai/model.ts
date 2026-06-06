import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { getAISettings } from "@/lib/store";
import type { AIProvider } from "@/lib/types";

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

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  configured: boolean;
  /** Where the active key/provider came from, for UI transparency. */
  source: "settings" | "env";
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

function isProvider(v: string): v is AIProvider {
  return (PROVIDERS as readonly string[]).includes(v);
}

/**
 * Resolve the active AI configuration from in-app settings, falling back to
 * environment variables. Async because settings are read from local storage.
 */
export async function loadAIConfig(): Promise<AIConfig> {
  const s = await getAISettings();

  const storedKey = (p: AIProvider) => s.keys?.[p]?.trim() || undefined;
  const mergedKey = (p: AIProvider) => storedKey(p) ?? envKey(p);

  const explicitSetting =
    s.provider && s.provider !== "auto" && isProvider(s.provider) ? s.provider : undefined;
  const envRaw = (process.env.AI_PROVIDER ?? "").toLowerCase();
  const explicitEnv = isProvider(envRaw) ? envRaw : undefined;

  const autoDetect = (): AIProvider => {
    for (const p of PROVIDERS) if (mergedKey(p)) return p;
    return "anthropic";
  };

  const provider = explicitSetting ?? explicitEnv ?? autoDetect();
  const model = s.model?.trim() || process.env.AI_MODEL || DEFAULT_MODELS[provider];
  const apiKey = mergedKey(provider);
  const configured =
    provider === "gateway" ? Boolean(apiKey || process.env.VERCEL_OIDC_TOKEN) : Boolean(apiKey);
  const source: "settings" | "env" =
    storedKey(provider) || explicitSetting || s.model?.trim() ? "settings" : "env";

  return { provider, model, apiKey, configured, source };
}

/** Build the language model for the given resolved config. */
export function resolveModel(cfg: AIConfig): LanguageModel {
  switch (cfg.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey })(cfg.model);
    case "openai":
      return createOpenAI({ apiKey: cfg.apiKey })(cfg.model);
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
