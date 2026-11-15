import { NextResponse } from "next/server";
import { getProjectsSettings, saveProjectsSettings } from "@/lib/store";
import type { ProjectsSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * プロジェクト・ハブの表示設定（誰待ちの強調しきい値など）。
 * local-first: `.data/projects-settings.json` にのみ保存。表示の閾値であって、
 * 誰待ち判定ロジック（computeWaiting）は変えない。
 */
export async function GET() {
  return NextResponse.json(await getProjectsSettings());
}

export async function POST(req: Request) {
  let body: ProjectsSettings;
  try {
    body = (await req.json()) as ProjectsSettings;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  // 保存側で 1〜60 にクランプ・既定補完される。
  const saved = await saveProjectsSettings({ stalledDays: body.stalledDays });
  return NextResponse.json({ ok: true, ...saved });
}
