import { NextResponse } from "next/server";
import { getTeamRulesSettings, saveTeamRulesSettings } from "@/lib/store";
import {
  isTeamRulesConfigured,
  readTeamRules,
  teamRulesFileExists,
} from "@/lib/integrations/team-rules";
import type { TeamRulesSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

async function safeView() {
  const s = await getTeamRulesSettings();
  const exists = await teamRulesFileExists(s.filePath);
  const rules = await readTeamRules(s);
  return {
    filePath: s.filePath ?? "",
    fileExists: exists,
    rules,
    ruleCount: rules.length,
    // パスが設定済みなら接続扱い（ファイルは「チームに提案」で作られることもある）。
    configured: isTeamRulesConfigured(s),
  };
}

export async function GET() {
  return NextResponse.json(await safeView());
}

export async function POST(req: Request) {
  let body: TeamRulesSettings;
  try {
    body = (await req.json()) as TeamRulesSettings;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const patch: TeamRulesSettings = {};
  if (typeof body.filePath === "string") patch.filePath = body.filePath; // "" clears

  await saveTeamRulesSettings(patch);
  return NextResponse.json({ ok: true, ...(await safeView()) });
}
