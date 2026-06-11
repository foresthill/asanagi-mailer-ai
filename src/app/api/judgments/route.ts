import { NextResponse } from "next/server";
import { judgmentStats, listJudgments, setJudgmentVerdict } from "@/lib/db";
import { recordImportanceFeedback } from "@/lib/store";
import type { Importance } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 仕分けレビュー: the judgment log with accuracy stats. */
export async function GET() {
  return NextResponse.json({ items: listJudgments(), stats: judgmentStats() });
}

/**
 * Record the user's verdict on a judgment. The correction (or confirmation)
 * also feeds the live signal store immediately — so the very next list load
 * already reflects it — and accumulates as supervised training data.
 */
export async function PATCH(req: Request) {
  const { account, emailId, fromEmail, verdict } = (await req.json()) as {
    account: string;
    emailId: string;
    fromEmail: string;
    verdict: Importance;
  };
  if (!account || !emailId || !["high", "normal", "low"].includes(verdict)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  setJudgmentVerdict(account, emailId, verdict);
  if (fromEmail) await recordImportanceFeedback(fromEmail, verdict);
  return NextResponse.json({ ok: true, stats: judgmentStats() });
}
