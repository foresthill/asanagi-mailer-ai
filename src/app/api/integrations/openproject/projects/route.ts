import { NextResponse } from "next/server";
import { getOpenProjectSettings } from "@/lib/store";
import { listProjects, normalizeBaseUrl } from "@/lib/integrations/openproject";

export const dynamic = "force-dynamic";

/**
 * Test the connection and list projects for the settings picker. Accepts an
 * optional { baseUrl, apiKey } so the user can verify BEFORE saving; falls back
 * to the stored credentials (e.g. re-listing with the key already on file).
 */
export async function POST(req: Request) {
  let body: { baseUrl?: string; apiKey?: string } = {};
  try {
    body = (await req.json()) as { baseUrl?: string; apiKey?: string };
  } catch {
    /* empty body = use stored settings */
  }

  const stored = await getOpenProjectSettings();
  const baseUrl = normalizeBaseUrl(body.baseUrl ?? stored.baseUrl);
  // Blank string in the form means "keep stored key" (it's masked in the UI).
  const apiKey = (body.apiKey?.trim() || stored.apiKey || "").trim();

  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { ok: false, error: "URL と API キーを入力してください。" },
      { status: 400 },
    );
  }

  try {
    const projects = await listProjects(baseUrl, apiKey);
    return NextResponse.json({ ok: true, projects });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "接続に失敗しました。",
      },
      { status: 200 },
    );
  }
}
