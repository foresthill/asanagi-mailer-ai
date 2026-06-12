import { NextResponse } from "next/server";
import { searchCached, upsertEmails } from "@/lib/db";
import { listAccounts, getProviderFor } from "@/lib/email/accounts";
import { listSignals } from "@/lib/store";
import { annotateImportance } from "@/lib/importance";
import type { Email } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Search across accounts and folders: GET /api/search?q=keyword
 *
 * Default scope is the local cache (fast, offline, grows as folders are
 * viewed). `&scope=server` additionally runs the providers' full-history
 * search (Gmail `q=` — native operators work; IMAP SEARCH) and merges the
 * results — the on-demand deep-dig for mail that never entered the cache
 * (#40). 受信箱の表示開始日とは独立（検索は全履歴が対象）。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const scope = url.searchParams.get("scope") ?? "cache";
  if (!q) return NextResponse.json({ emails: [] });

  // Cache hits first — qualified ids keyed for dedupe against server hits.
  const merged = new Map<string, Email>();
  for (const e of searchCached(q)) {
    merged.set(`${e.account}/${e.id}`, { ...e, id: `${e.account}/${e.id}` });
  }

  const stale: string[] = [];
  if (scope === "server") {
    const accounts = await listAccounts();
    await Promise.all(
      accounts.map(async (a) => {
        try {
          const provider = await getProviderFor(a.key);
          if (!provider.search) return;
          const found = await provider.search(q);
          upsertEmails(a.key, found); // deep finds become cache (and offline) hits
          for (const e of found) {
            const id = `${a.key}/${e.id}`;
            if (!merged.has(id)) merged.set(id, { ...e, account: a.key, id });
          }
        } catch {
          stale.push(a.key); // provider unreachable — cache results still stand
        }
      }),
    );
  }

  const signals = await listSignals();
  const emails = annotateImportance(
    [...merged.values()].sort((a, b) => +new Date(b.date) - +new Date(a.date)),
    signals,
  );
  return NextResponse.json({ emails, scope, stale });
}
