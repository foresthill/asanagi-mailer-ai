import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/**
 * Provider abstraction so the email AI can run on Claude, OpenRouter,
 * the Vercel AI Gateway, or (future) a local model — switchable via env,
 * without touching feature code.
 *
 * Configure with:
 *   AI_PROVIDER = anthropic | openai | openrouter | gateway   (default: anthropic)
 *   AI_MODEL    = provider-specific model id                  (sensible default per provider)
 *
 * NOTE on model ids: keep these in env. The defaults below are reasonable
 * starting points but you should set AI_MODEL to the exact current id your
 * provider exposes (model ids change over time).
 */
export type AIProvider = "anthropic" | "openai" | "openrouter" | "gateway";

function envProvider(): AIProvider {
  const p = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if (p === "anthropic" || p === "openai" || p === "openrouter" || p === "gateway") {
    return p;
  }
  // Auto-detect from available keys, preferring Claude.
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.AI_GATEWAY_API_KEY) return "gateway";
  return "anthropic";
}

const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  openrouter: "anthropic/claude-sonnet-4.5",
  gateway: "anthropic/claude-sonnet-4.5",
};

/** True when at least one provider credential is configured. */
export function isAIConfigured(): boolean {
  const p = envProvider();
  switch (p) {
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY);
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY);
    case "openrouter":
      return Boolean(process.env.OPENROUTER_API_KEY);
    case "gateway":
      return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
  }
}

/** Resolve the configured language model for streaming / generation calls. */
export function resolveModel(): LanguageModel {
  const provider = envProvider();
  const modelId = process.env.AI_MODEL || DEFAULT_MODELS[provider];

  switch (provider) {
    case "anthropic":
      return anthropic(modelId);
    case "openai":
      return openai(modelId);
    case "openrouter": {
      const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
      return openrouter(modelId);
    }
    case "gateway":
      // The AI Gateway accepts plain "provider/model" strings.
      return modelId;
  }
}

export function modelLabel(): string {
  return `${envProvider()}:${process.env.AI_MODEL || DEFAULT_MODELS[envProvider()]}`;
}
