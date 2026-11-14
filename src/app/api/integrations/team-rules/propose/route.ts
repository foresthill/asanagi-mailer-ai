import { NextResponse } from "next/server";
import { recordLog, errMsg } from "@/lib/logbuf";
import { getTeamRulesSettings } from "@/lib/store";
import {
  appendTeamRule,
  isTeamRulesConfigured,
} from "@/lib/integrations/team-rules";

export const dynamic = "force-dynamic";

/**
 * Propose one abstract writing-style rule line to the shared team file
 * (opt-in「チームに提案」). Appends to team-rules.json in the synced folder. The
 * line is a general rule only (no bodies, no PII) — the UI previews it before
 * the user confirms. Idempotent: an already-shared line is not duplicated.
 */
export async function POST(req: Request) {
  let body: { rule?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const rule = (body.rule ?? "").trim();
  if (!rule) {
    return NextResponse.json(
      { ok: false, error: "ルールが空です。" },
      { status: 400 },
    );
  }

  const s = await getTeamRulesSettings();
  if (!isTeamRulesConfigured(s)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "チーム共有が未設定です。設定から共有ファイルのパスを指定してください。",
      },
      { status: 400 },
    );
  }

  try {
    const rules = await appendTeamRule(s, rule);
    recordLog("info", "team-rules", `チームにルール提案: ${rule}`);
    return NextResponse.json({ ok: true, rules });
  } catch (e) {
    recordLog("error", "team-rules", `提案失敗: ${errMsg(e)}`);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "提案に失敗しました。",
      },
      { status: 200 },
    );
  }
}
