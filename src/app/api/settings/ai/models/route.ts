import { NextResponse } from "next/server";
import { getAISettings } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * List the models an OpenAI-compatible endpoint (e.g. an on-prem Ollama's /v1)
 * exposes, so the connection settings can offer a picker instead of a free-text
 * model id — and double as a connection test for the on-prem AI tunnel. Accepts
 * an optional { baseUrl, apiKey } so the user can check BEFORE saving; falls
 * back to stored settings. local-first: the request only ever reaches the
 * user's own endpoint.
 */
export async function POST(req: Request) {
  let body: { baseUrl?: string; apiKey?: string } = {};
  try {
    body = (await req.json()) as { baseUrl?: string; apiKey?: string };
  } catch {
    /* empty body = use stored settings */
  }

  const stored = await getAISettings();
  // Trim trailing slashes; `${baseUrl}/models` is the OpenAI-compatible list
  // endpoint (Ollama serves it at .../v1/models).
  const baseUrl = (body.baseUrl ?? stored.baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  // Blank in the form means "keep stored key" (it's masked in the UI). A bare
  // local Ollama needs no key.
  const apiKey = (body.apiKey?.trim() || stored.keys?.openai?.trim() || "").trim();

  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: "エンドポイントURLを入力してください。" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      // A dead tunnel should fail fast, not hang the dialog.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `HTTP ${res.status}` },
        { status: 200 },
      );
    }
    const json = (await res.json()) as { data?: { id?: string }[] };
    const models = (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ ok: true, models });
  } catch (e) {
    const timedOut =
      e instanceof Error && (e.name === "TimeoutError" || /timeout/i.test(e.message));
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
