import { NextResponse } from "next/server";
import { listMailAccounts } from "@/lib/store";
import { imapCredsFrom } from "@/lib/email";
import { testImapCreds } from "@/lib/email/connectivity";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Test one IMAP account's connectivity by id (IMAP + SMTP login, no send).
 * Gmail accounts are validated by the OAuth connect flow instead, so this
 * route only tests IMAP accounts.
 */
export async function POST(req: Request) {
  let id = "";
  try {
    const body = (await req.json()) as { id?: string };
    id = typeof body.id === "string" ? body.id : "";
  } catch {
    // no/invalid body → missing-id error below
  }
  if (!id) {
    return NextResponse.json({ ok: false, error: "id が必要です" }, { status: 400 });
  }

  const account = (await listMailAccounts()).find((a) => a.id === id);
  if (!account) {
    return NextResponse.json({ ok: false, error: "該当アカウントなし" }, { status: 404 });
  }
  if (account.type !== "imap") {
    return NextResponse.json(
      { ok: false, error: "IMAP アカウントのみテストできます" },
      { status: 400 },
    );
  }

  const creds = imapCredsFrom(account.imap);
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: "ホスト・ユーザー・パスワードを保存してからテストしてください" },
      { status: 400 },
    );
  }
  const result = await testImapCreds(creds);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
