import { NextResponse } from "next/server";
import { recordImportanceFeedback, recordSweepAction } from "@/lib/store";
import type { Importance } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 判断を学習する（教師信号）。朝の一凪の「適用」と、受信箱での直接
 * アーカイブ/ゴミ箱の両方から呼ぶ。本文は一切扱わない。バルク操作でも
 * JSON書き込みが競合しないよう、呼び出し側が全件を1リクエストにまとめ、
 * ここで順次処理する。
 *  - importance（任意）: keep=normal / ゴミ箱=low など。省略時は重要度を
 *    変えない（例: アーカイブは「対応済みの重要メール」の可能性もあるため、
 *    処分だけ憶えて重要度は触らない）。
 *  - action（任意）: 実際に選んだ処分（archive / trash）を送信者・ドメインへ。
 *    importance だけでは archive と trash を区別できず、毎回「アーカイブ→
 *    ゴミ箱」を押し直すことになるため（次回の一凪はこの処分を既定にする）。
 */
export async function POST(req: Request) {
  const { signals } = (await req.json()) as {
    signals: { fromEmail: string; importance?: Importance; action?: string }[];
  };
  if (!Array.isArray(signals)) return NextResponse.json({ ok: false }, { status: 400 });
  let learned = 0;
  for (const s of signals) {
    if (!s?.fromEmail) continue;
    try {
      let touched = false;
      if (s.importance && ["high", "normal", "low"].includes(s.importance)) {
        await recordImportanceFeedback(s.fromEmail, s.importance);
        touched = true;
      }
      if (s.action === "archive" || s.action === "trash") {
        await recordSweepAction(s.fromEmail, s.action);
        touched = true;
      }
      if (touched) learned++;
    } catch {
      /* best-effort */
    }
  }
  return NextResponse.json({ ok: true, learned });
}
