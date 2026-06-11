import { NextResponse } from "next/server";
import { contactsList } from "@/lib/db";
import { listAccounts } from "@/lib/email/accounts";

export const dynamic = "force-dynamic";

/**
 * Auto-derived address book (mini-CRM seed): everyone you've exchanged mail
 * with, from the local cache. No manual entry; grows as folders are viewed.
 */
export async function GET() {
  const accounts = await listAccounts();
  const self = accounts.map((a) => a.address).filter((s): s is string => !!s);
  return NextResponse.json({ contacts: contactsList(self) });
}
