import { NextResponse } from "next/server";
import { resolveImapCreds } from "@/lib/email";
import { testImapCreds } from "@/lib/email/connectivity";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Verify the saved IMAP/SMTP settings actually work: log in to IMAP and
 * open INBOX (returns message count), then verify the SMTP login.
 */
export async function POST() {
  const creds = await resolveImapCreds();
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: "IMAP のホスト・ユーザー・パスワードを保存してからテストしてください" },
      { status: 400 },
    );
  }
  const result = await testImapCreds(creds);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
