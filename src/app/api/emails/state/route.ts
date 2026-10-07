import { NextResponse } from "next/server";
import { getProvider } from "@/lib/email";
import { getProviderFor } from "@/lib/email/accounts";
import { updateCached } from "@/lib/db";
import { recordLog, errMsg } from "@/lib/logbuf";
import type { MailboxState } from "@/lib/types";

/**
 * Bulk state change: move MANY emails to one state in as few provider round-trips
 * as possible. Ids are account-qualified (`gmail/18c…`, `imap/INBOX:5`); we group
 * by account and call each provider's setStateBatch once (Gmail → one batchModify
 * per ≤1000 ids; IMAP → one move per source folder). This replaces the old
 * per-id fan-out (N PATCH /api/emails/[id]) that made 朝の一凪 fire dozens of
 * requests and hang. Writes the local cache per id to keep the list in sync.
 */

function isAuthError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes("invalid_grant") || m.includes("expired") || m.includes("revoked")
  );
}

export async function POST(req: Request) {
  const body = (await req.json()) as { ids?: string[]; state?: MailboxState };
  const ids = body.ids ?? [];
  const state = body.state;
  if (!state || ids.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  // account-qualified id → { account, providerId }; unqualified → default provider.
  const groups = new Map<string | null, string[]>();
  for (const raw of ids) {
    const decoded = decodeURIComponent(raw);
    const slash = decoded.indexOf("/");
    const account = slash > 0 ? decoded.slice(0, slash) : null;
    const pid = slash > 0 ? decoded.slice(slash + 1) : decoded;
    const arr = groups.get(account);
    if (arr) arr.push(pid);
    else groups.set(account, [pid]);
  }

  let updated = 0;
  let reauth = false;
  let failed = false;
  for (const [account, pids] of groups) {
    try {
      const provider = account
        ? await getProviderFor(account)
        : await getProvider();
      await provider.setStateBatch(pids, state);
      if (account) {
        for (const pid of pids) {
          try {
            updateCached(account, pid, { state });
          } catch {
            /* cache sync is best-effort */
          }
        }
      }
      updated += pids.length;
    } catch (err) {
      failed = true;
      if (isAuthError(err)) reauth = true;
      recordLog(
        "error",
        "state",
        `${account ?? "default"}: ${state} 反映失敗 (${pids.length}通): ${errMsg(err)}`,
      );
    }
  }

  if (failed) {
    // Mirror the per-id route: token expiry → 401 so the client shows reauth.
    return NextResponse.json(
      {
        ok: false,
        updated,
        needsReauth: reauth,
        error: reauth
          ? "Gmailの認証が切れています（接続設定から再認証してください）"
          : "一部のメールを移動できませんでした（サーバ反映に失敗）",
      },
      { status: reauth ? 401 : 500 },
    );
  }
  return NextResponse.json({ ok: true, updated });
}
