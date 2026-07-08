import { NextResponse } from "next/server";
import { getReplySignatures, saveReplySignature } from "@/lib/store";
import { listAccounts } from "@/lib/email/accounts";

export const dynamic = "force-dynamic";

/**
 * Per-account reply identity/signature (AI返信での名乗り). Steers the reply
 * draft to write AS the account owner even when the thread history is signed
 * by someone else (shared/CC'd mailbox). Not a secret — echoed back plainly.
 */
export async function GET() {
  const [signatures, accounts] = await Promise.all([getReplySignatures(), listAccounts()]);
  return NextResponse.json({
    signatures,
    accounts: accounts.map((a) => ({ key: a.key, label: a.label, address: a.address })),
  });
}

export async function POST(req: Request) {
  const { account, text } = (await req.json()) as { account?: string; text?: string };
  if (!account || typeof account !== "string") {
    return NextResponse.json({ error: "account が必要です" }, { status: 400 });
  }
  await saveReplySignature(account, typeof text === "string" ? text : "");
  return NextResponse.json({ ok: true });
}
