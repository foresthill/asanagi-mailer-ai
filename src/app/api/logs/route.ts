import { NextResponse } from "next/server";
import { getLogs, clearLogs } from "@/lib/logbuf";

export const dynamic = "force-dynamic";

/** 動作ログの取得（アプリ内ビューア用）。新しい順。 */
export async function GET() {
  return NextResponse.json({ logs: getLogs() });
}

/** ログを消去。 */
export async function DELETE() {
  clearLogs();
  return NextResponse.json({ ok: true });
}
