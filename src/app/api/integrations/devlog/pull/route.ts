import { NextResponse } from "next/server";
import { getDevlogSettings } from "@/lib/store";
import { isDevlogConfigured, listOpenIssues } from "@/lib/integrations/devlog";

export const dynamic = "force-dynamic";

/**
 * Read-only pull of the configured project's open issues. On-demand (called when
 * the TODO view opens); nothing is written or synced.
 */
export async function GET() {
  const settings = await getDevlogSettings();
  if (!isDevlogConfigured(settings) || !settings.projectKey) {
    return NextResponse.json({ ok: false, items: [] });
  }
  try {
    const items = await listOpenIssues(settings);
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        items: [],
        error: e instanceof Error ? e.message : "取得に失敗しました。",
      },
      { status: 200 },
    );
  }
}
