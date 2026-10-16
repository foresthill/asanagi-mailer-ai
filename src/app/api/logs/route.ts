import { NextResponse } from "next/server";
import { getLogs, clearLogs, recordLog, type LogLevel } from "@/lib/logbuf";

export const dynamic = "force-dynamic";

/** 動作ログの取得（アプリ内ビューア用）。新しい順。 */
export async function GET() {
  return NextResponse.json({ logs: getLogs() });
}

/**
 * クライアント側から1行記録する。サーバのルートが（バンドル不良などで）手前で
 * 500 して自前の recordLog に到達できなかった場合でも、UI 側が掴んだ生の理由を
 * 動作ログに残せるようにするための受け口。
 */
export async function POST(req: Request) {
  let body: { level?: string; scope?: string; message?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const level: LogLevel =
    body.level === "warn" || body.level === "info" ? body.level : "error";
  const scope = typeof body.scope === "string" ? body.scope.slice(0, 32) : "client";
  const message = typeof body.message === "string" ? body.message : "";
  if (message) recordLog(level, scope, message);
  return NextResponse.json({ ok: true });
}

/** ログを消去。 */
export async function DELETE() {
  clearLogs();
  return NextResponse.json({ ok: true });
}
