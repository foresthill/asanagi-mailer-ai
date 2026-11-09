import { NextResponse } from "next/server";
import { listWritingSamples, recordWritingSample } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * 返信文体の教師データ（個人的無意識）。AIの下書きと、ユーザーが実際に送った
 * 自筆部分のペアを貯める pull 型の素材置き場。GET=一覧（昇格UI用）、
 * POST=送信成功時に1件追記。local-first: 本文を含むため .data 内に留まり、
 * どこにも送らない（学習履歴gitにも載せない）。
 */

/** GET → 教師データ一覧（新しい順）。 */
export async function GET() {
  const items = await listWritingSamples();
  return NextResponse.json({ items: [...items].reverse() });
}

/** POST { account?, subject?, ai, final } → 1件追記（ai/final が空なら no-op）。 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    account?: string;
    subject?: string;
    ai?: string;
    final?: string;
  };
  await recordWritingSample({
    account: body.account,
    subject: body.subject,
    ai: body.ai ?? "",
    final: body.final ?? "",
  });
  return NextResponse.json({ ok: true });
}
