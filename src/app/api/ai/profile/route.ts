import { NextResponse } from "next/server";
import { getJudgmentProfile, saveJudgmentProfile } from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET → the user's natural-language preference profile (AIへのメモ). */
export async function GET() {
  return NextResponse.json({ profile: await getJudgmentProfile() });
}

/** POST { text } → save it. Injected into the importance/sweep judgments. */
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  await saveJudgmentProfile(typeof text === "string" ? text : "");
  return NextResponse.json({ ok: true });
}
