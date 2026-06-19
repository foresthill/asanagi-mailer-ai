import { NextResponse } from "next/server";
import { recordImportanceFeedback } from "@/lib/store";
import type { Importance } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 朝の一凪で確定した判断を、送信者の学習シグナルへ反映する（教師信号）。
 * keep=normal / archive・trash=low を送信者・ドメインに記録 → 次回の判定
 * （無料の簡易判定含む）が賢くなる。本文は一切扱わない。
 */
export async function POST(req: Request) {
  const { signals } = (await req.json()) as {
    signals: { fromEmail: string; importance: Importance }[];
  };
  if (!Array.isArray(signals)) return NextResponse.json({ ok: false }, { status: 400 });
  let learned = 0;
  for (const s of signals) {
    if (!s?.fromEmail || !["high", "normal", "low"].includes(s.importance)) continue;
    try {
      await recordImportanceFeedback(s.fromEmail, s.importance);
      learned++;
    } catch {
      /* best-effort */
    }
  }
  return NextResponse.json({ ok: true, learned });
}
