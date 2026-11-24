import { NextResponse } from "next/server";
import { getAISettings } from "@/lib/store";
import { isProvider, type AIProvider } from "@/lib/ai/model";

export const dynamic = "force-dynamic";

/**
 * List the model ids a provider exposes, so 接続設定 can offer a picker instead
 * of a hand-typed model id — and double as a lightweight connection check (a
 * successful list proves the key/endpoint works). Works for:
 *   - OpenAI-compatible endpoints (on-prem Ollama /v1, or any custom baseUrl)
 *   - Cloud BYOK providers: anthropic / openai / openrouter / gateway
 *
 * Accepts { provider?, baseUrl?, apiKey? }; a blank apiKey means "use the stored
 * (masked) key" so the user can pick models without re-typing. local-first: the
 * request only ever reaches the chosen provider's own API — the same destination
 * a normal AI call uses — and the key is never logged or returned.
 */

// "List models" endpoint + auth per cloud provider. Verified against each
// provider's official docs (2026-11):
//   anthropic:  GET https://api.anthropic.com/v1/models  (x-api-key + anthropic-version)
//   openai:     GET https://api.openai.com/v1/models     (Authorization: Bearer)
//   openrouter: GET https://openrouter.ai/api/v1/models  (public; key optional)
//   gateway:    GET https://ai-gateway.vercel.sh/v1/models (Authorization: Bearer; OpenAI-format)
// All return { data: [{ id }] }; Anthropic also carries display_name/lifecycle.
function cloudModelsRequest(
  provider: AIProvider,
  apiKey: string,
): { url: string; headers: Record<string, string> } {
  switch (provider) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models?limit=1000",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/models",
        headers: { authorization: `Bearer ${apiKey}` },
      };
    case "openrouter":
      // Public catalog — key optional.
      return {
        url: "https://openrouter.ai/api/v1/models",
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      };
    case "gateway":
      return {
        url: "https://ai-gateway.vercel.sh/v1/models",
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      };
  }
}

function envKeyFor(p: AIProvider): string {
  switch (p) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ?? "";
    case "openai":
      return process.env.OPENAI_API_KEY ?? "";
    case "openrouter":
      return process.env.OPENROUTER_API_KEY ?? "";
    case "gateway":
      return (
        process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || ""
      );
  }
}

export async function POST(req: Request) {
  let body: { provider?: string; baseUrl?: string; apiKey?: string } = {};
  try {
    body = (await req.json()) as {
      provider?: string;
      baseUrl?: string;
      apiKey?: string;
    };
  } catch {
    /* empty body = use stored settings */
  }

  const stored = await getAISettings();
  // Trim trailing slashes; `${baseUrl}/models` is the OpenAI-compatible list
  // endpoint (Ollama serves it at .../v1/models).
  const baseUrl = (body.baseUrl ?? "").trim().replace(/\/+$/, "");
  const providerRaw = (body.provider ?? "").trim();
  const provider = isProvider(providerRaw) ? providerRaw : undefined;

  // A baseUrl (on-prem / custom OpenAI-compatible endpoint) wins over the cloud
  // provider endpoint — that's what on-prem Ollama needs. Blank key in the form
  // means "keep stored key" (it's masked in the UI); a bare local Ollama needs none.
  if (baseUrl) {
    const apiKey = (
      body.apiKey?.trim() ||
      stored.keys?.openai?.trim() ||
      ""
    ).trim();
    return listModels(
      `${baseUrl}/models`,
      apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    );
  }

  if (!provider) {
    return NextResponse.json(
      {
        ok: false,
        error: "プロバイダまたはエンドポイントURLを指定してください。",
      },
      { status: 400 },
    );
  }

  const apiKey = (
    body.apiKey?.trim() ||
    stored.keys?.[provider]?.trim() ||
    envKeyFor(provider)
  ).trim();
  // anthropic / openai require a key to even list; openrouter / gateway don't.
  if (!apiKey && (provider === "anthropic" || provider === "openai")) {
    return NextResponse.json(
      { ok: false, error: "APIキーを入力してください。" },
      { status: 200 },
    );
  }

  const reqInfo = cloudModelsRequest(provider, apiKey);
  return listModels(reqInfo.url, reqInfo.headers, provider);
}

async function listModels(
  url: string,
  headers: Record<string, string>,
  provider?: AIProvider,
): Promise<Response> {
  try {
    const res = await fetch(url, {
      headers,
      // A dead tunnel / wrong key should fail fast, not hang the dialog.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `HTTP ${res.status}` },
        { status: 200 },
      );
    }
    const json = (await res.json()) as {
      data?: { id?: string; lifecycle?: string }[];
    };
    let rows = json.data ?? [];
    // Anthropic marks retired models in the catalogue — don't offer those.
    if (provider === "anthropic") {
      rows = rows.filter((m) => m.lifecycle !== "retired");
    }
    const models = rows
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    // On-prem (no provider) keeps the alpha sort; cloud preserves API order
    // (Anthropic / OpenRouter return newest-first, which is the useful order).
    const out = provider
      ? models
      : [...models].sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ ok: true, models: out });
  } catch (e) {
    const timedOut =
      e instanceof Error &&
      (e.name === "TimeoutError" || /timeout/i.test(e.message));
    return NextResponse.json(
      {
        ok: false,
        error: timedOut
          ? "接続タイムアウト（トンネル未接続の可能性）"
          : e instanceof Error
            ? e.message
            : "接続に失敗しました。",
      },
      { status: 200 },
    );
  }
}
