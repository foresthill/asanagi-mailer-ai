import { NextResponse } from "next/server";
import { listAccounts, getProviderFor } from "@/lib/email/accounts";
import { cachedList, repliedThreadIds, upsertEmails } from "@/lib/db";
import { listSignals } from "@/lib/store";
import { annotateImportance } from "@/lib/importance";
import type { Email, MailboxState } from "@/lib/types";

export const dynamic = "force-dynamic";

/** API ids are account-qualified: `${account}/${providerId}`. */
function tag(account: string, e: Email): Email {
  return { ...e, account, id: `${account}/${e.id}` };
}

/** Mark conversations we've replied to (own sent message in the thread). */
function markReplied(account: string, emails: Email[]): Email[] {
  const replied = repliedThreadIds(
    account,
    emails.map((e) => e.threadId),
  );
  return emails.map((e) =>
    e.state !== "sent" && replied.has(e.threadId) ? { ...e, replied: true } : e,
  );
}

/**
 * List emails for one account or all accounts (unified inbox).
 *   GET /api/emails?state=inbox&account=all|gmail|imap|mock
 * Live-fetches each account, writes through to the local SQLite cache, and
 * falls back to the cache for any account whose provider is unreachable.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = (url.searchParams.get("state") as MailboxState) || "inbox";
  const account = url.searchParams.get("account") || "all";

  try {
    const accounts = await listAccounts();
    const targets = account === "all" ? accounts : accounts.filter((a) => a.key === account);
    if (!targets.length) {
      return NextResponse.json({ emails: [], accounts, stale: [] });
    }

    const stale: string[] = [];
    const lists = await Promise.all(
      targets.map(async (a) => {
        try {
          const provider = await getProviderFor(a.key);
          const emails = await provider.list(state);
          upsertEmails(a.key, emails); // write-through (raw provider ids)
          return markReplied(a.key, emails).map((e) => tag(a.key, e));
        } catch {
          // Provider unreachable → serve the local cache for this account.
          stale.push(a.key);
          return markReplied(a.key, cachedList([a.key], state)).map((e) => ({
            ...e,
            id: `${a.key}/${e.id}`,
          }));
        }
      }),
    );

    // Free importance layers (learned signals > keyword) for the whole list —
    // no AI cost; the LLM refines individual emails when opened.
    const signals = await listSignals();
    const emails = annotateImportance(
      lists
        .flat()
        .sort((a, b) => +new Date(b.date) - +new Date(a.date))
        .slice(0, 100),
      signals,
    );

    return NextResponse.json({ emails, accounts, stale });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to list" },
      { status: 500 },
    );
  }
}
