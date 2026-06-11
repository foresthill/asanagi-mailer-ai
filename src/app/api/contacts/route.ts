import { NextResponse } from "next/server";
import { contactsList, upsertEmails } from "@/lib/db";
import { listAccounts, getProviderFor } from "@/lib/email/accounts";
import type { MailboxState } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Auto-derived address book (mini-CRM seed): everyone you've exchanged mail
 * with, from the local cache. No manual entry; grows as folders are viewed.
 *
 * ?warm=1 first refreshes the sent/archived caches from each provider —
 * those folders are rarely opened, so correspondents who live only there
 * were missing from the list (取りこぼし対策). Best-effort: an unreachable
 * provider never blocks the response.
 */
export async function GET(req: Request) {
  const accounts = await listAccounts();
  const self = accounts.map((a) => a.address).filter((s): s is string => !!s);

  if (new URL(req.url).searchParams.get("warm")) {
    await Promise.allSettled(
      accounts.map(async (a) => {
        const provider = await getProviderFor(a.key);
        for (const state of ["sent", "archived"] as MailboxState[]) {
          try {
            upsertEmails(a.key, await provider.list(state));
          } catch {
            /* offline / folder missing — serve what the cache has */
          }
        }
      }),
    );
  }

  return NextResponse.json({ contacts: contactsList(self) });
}
