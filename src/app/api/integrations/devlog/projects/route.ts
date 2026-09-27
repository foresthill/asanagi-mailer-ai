import { NextResponse } from "next/server";
import { getDevlogSettings } from "@/lib/store";
import { listProjects, normalizeBaseUrl } from "@/lib/integrations/devlog";

export const dynamic = "force-dynamic";

/**
 * Test the connection and list projects for the settings picker. Accepts an
 * optional { baseUrl, token } so the user can verify BEFORE saving; falls back
 * to the stored credentials (the token is masked in the UI).
 */
export async function POST(req: Request) {
  let body: { baseUrl?: string; token?: string } = {};
  try {
    body = (await req.json()) as { baseUrl?: string; token?: string };
  } catch {
    /* empty body = use stored settings */
  }

  const stored = await getDevlogSettings();
  const baseUrl = normalizeBaseUrl(body.baseUrl ?? stored.baseUrl);
  const token = (body.token?.trim() || stored.token || "").trim();

  if (!baseUrl || !token) {
    return NextResponse.json(
      { ok: false, error: "URL と MCP トークンを入力してください。" },
      { status: 400 },
    );
  }

  try {
    const projects = await listProjects(baseUrl, token);
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
