import { NextResponse } from "next/server";
import { recordImportanceFeedback, recordSweepAction } from "@/lib/store";
import type { Importance } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 朝の一凪で確定した判断を学習する（教師信号）。本文は一切扱わない。
 *  - importance: keep=normal / archive・trash=low を送信者・ドメインへ。
 *  - action: 実際に選んだ処分（archive / trash）も憶える。importance だけでは
 *    archive と trash を区別できず、毎回「アーカイブ→ゴミ箱」を押し直すことに
 *    なるため（次回の一凪はこの処分を既定にする）。
 */
export async function POST(req: Request) {
  const { signals } = (await req.json()) as {
    signals: { fromEmail: string; importance: Importance; action?: string }[];
  };
  if (!Array.isArray(signals)) return NextResponse.json({ ok: false }, { status: 400 });
  let learned = 0;
  for (const s of signals) {
    if (!s?.fromEmail || !["high", "normal", "low"].includes(s.importance)) continue;
    try {
      await recordImportanceFeedback(s.fromEmail, s.importance);
      if (s.action === "archive" || s.action === "trash") {
        await recordSweepAction(s.fromEmail, s.action);
      }
      learned++;
    } catch {
      /* best-effort */
    }
  }
  return NextResponse.json({ ok: true, learned });
}
