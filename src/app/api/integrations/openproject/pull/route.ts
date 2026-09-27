import { NextResponse } from "next/server";
import { getOpenProjectSettings } from "@/lib/store";
import {
  isOpConfigured,
  listMyOpenWorkPackages,
} from "@/lib/integrations/openproject";

export const dynamic = "force-dynamic";

/**
 * Read-only pull of the user's open work packages in the default project.
 * On-demand (called when the TODO view opens); nothing is written or synced.
 */
export async function GET() {
  const settings = await getOpenProjectSettings();
  if (!isOpConfigured(settings) || !settings.projectId) {
    return NextResponse.json({ ok: false, items: [] });
  }
  try {
    const items = await listMyOpenWorkPackages(settings);
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
