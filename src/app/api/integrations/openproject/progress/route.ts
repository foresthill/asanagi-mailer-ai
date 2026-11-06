import { NextResponse } from "next/server";

import { getOpenProjectSettings } from "@/lib/store";
import {
  getProjectProgress,
  isOpConfigured,
} from "@/lib/integrations/openproject";

export const dynamic = "force-dynamic";

/**
 * Read-only pull of the default project's progress (counts by status + a few
 * recently-updated work packages). On-demand — called when the TODO view opens;
 * nothing is written or synced. This is the "毎日の進捗の吸い上げ" surface: open
 * it each morning to see where the project stands.
 */
export async function GET() {
  const settings = await getOpenProjectSettings();
  if (!isOpConfigured(settings) || !settings.projectId) {
    return NextResponse.json({ ok: false, progress: null });
  }
  try {
    const progress = await getProjectProgress(settings);
    return NextResponse.json({ ok: true, progress });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        progress: null,
        error: e instanceof Error ? e.message : "取得に失敗しました。",
      },
      { status: 200 },
    );
  }
}
