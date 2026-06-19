import { NextResponse } from "next/server";
import { listAccounts, getProviderFor } from "@/lib/email/accounts";
import { cachedList, cachedStarred, repliedThreadIds, upsertEmails } from "@/lib/db";
import { getEmailSettings, listSignals } from "@/lib/store";
import { annotateImportance } from "@/lib/importance";
import type { Email, FolderView, MailboxState } from "@/lib/types";

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
 * Shared post-processing: enforce the per-account 受信箱の表示開始日 horizon,
 * layer free importance (learned signals > keyword), sort newest-first, cap.
 * Used by both the live and the cache-only paths so they stay identical.
 */
async function finalize(lists: Email[][], state: FolderView): Promise<Email[]> {
  const cfg = state === "inbox" ? await getEmailSettings() : null;
  const cutoffMs: Record<string, number> = {
    gmail: cfg ? +new Date(cfg.gmail?.inboxCutoff ?? cfg.inboxCutoff ?? NaN) : NaN,
    imap: cfg ? +new Date(cfg.imap?.inboxCutoff ?? cfg.inboxCutoff ?? NaN) : NaN,
  };
  const afterHorizon = (e: Email) => {
    const ms = cutoffMs[e.account ?? ""];
    return ms === undefined || Number.isNaN(ms) || +new Date(e.date) >= ms;
  };
  const signals = await listSignals();
  return annotateImportance(
    lists
      .flat()
      .filter(afterHorizon)
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .slice(0, 100),
    signals,
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
  const state = (url.searchParams.get("state") as FolderView) || "inbox";
  const account = url.searchParams.get("account") || "all";

  try {
    const accounts = await listAccounts();
    const targets = account === "all" ? accounts : accounts.filter((a) => a.key === account);
    if (!targets.length) {
      return NextResponse.json({ emails: [], accounts, stale: [] });
    }

    // スター付き is a cross-folder flag, not a mailbox — served from the
    // local cache (star state refreshes with every live folder fetch).
    if (state === "starred") {
      const signals = await listSignals();
      const emails = annotateImportance(
        targets
          .flatMap((a) => markReplied(a.key, cachedStarred([a.key])).map((e) => tag(a.key, e)))
          .sort((a, b) => +new Date(b.date) - +new Date(a.date)),
        signals,
      );
      return NextResponse.json({ emails, accounts, stale: [] });
    }

    // Cache-only fast path (?cached=1): serve the local SQLite instantly with
    // NO provider calls, so the UI can paint immediately and revalidate live
    // in the background (stale-while-revalidate). stale = all targets.
    if (url.searchParams.get("cached") === "1") {
      const lists = targets.map((a) =>
        markReplied(a.key, cachedList([a.key], state)).map((e) => tag(a.key, e)),
      );
      const emails = await finalize(lists, state);
      return NextResponse.json({ emails, accounts, stale: targets.map((a) => a.key) });
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
          return markReplied(a.key, cachedList([a.key], state)).map((e) => tag(a.key, e));
        }
      }),
    );

    const emails = await finalize(lists, state);
    return NextResponse.json({ emails, accounts, stale });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to list" },
      { status: 500 },
    );
  }
}
