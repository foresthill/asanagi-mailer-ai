import { NextResponse } from "next/server";
import { getAISettings, saveAISettings } from "@/lib/store";
import { CHEAP_MODELS, DEFAULT_MODELS, loadAIConfig } from "@/lib/ai/model";
import type { AIProvider, AISettings } from "@/lib/types";

export const dynamic = "force-dynamic";

const PROVIDERS: readonly AIProvider[] = ["anthropic", "openai", "openrouter", "gateway"];

/** Never return the raw key — only whether it's set and its last 4 chars. */
function maskKey(key?: string): { set: boolean; last4?: string } {
  if (!key?.trim()) return { set: false };
  return { set: true, last4: key.trim().slice(-4) };
}

async function safeView() {
  const s = await getAISettings();
  const cfg = await loadAIConfig();
  const keys = Object.fromEntries(
    PROVIDERS.map((p) => [p, maskKey(s.keys?.[p])]),
  ) as Record<AIProvider, { set: boolean; last4?: string }>;
  return {
    provider: s.provider ?? "auto",
    model: s.model ?? "",
    judgmentModel: s.judgmentModel ?? "",
    piiMask: s.piiMask ?? true,
    keys,
    defaultModels: DEFAULT_MODELS,
    cheapModels: CHEAP_MODELS,
    active: {
      provider: cfg.provider,
      model: cfg.model,
      judgmentModel: cfg.judgmentModel,
      configured: cfg.configured,
      source: cfg.source,
    },
  };
}

export async function GET() {
  return NextResponse.json(await safeView());
}

export async function POST(req: Request) {
  let body: AISettings;
  try {
    body = (await req.json()) as AISettings;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const patch: AISettings = {};
  if (body.provider && (body.provider === "auto" || PROVIDERS.includes(body.provider))) {
    patch.provider = body.provider;
  }
  if (typeof body.model === "string") patch.model = body.model;
  if (typeof body.judgmentModel === "string") patch.judgmentModel = body.judgmentModel;
  if (typeof body.piiMask === "boolean") patch.piiMask = body.piiMask;
  if (body.keys && typeof body.keys === "object") {
    const keys: Partial<Record<AIProvider, string>> = {};
    for (const p of PROVIDERS) {
      const v = body.keys[p];
      if (typeof v === "string") keys[p] = v; // empty string clears (handled in store)
    }
    patch.keys = keys;
  }

  await saveAISettings(patch);
  return NextResponse.json({ ok: true, ...(await safeView()) });
}
