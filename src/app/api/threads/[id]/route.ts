import { NextResponse } from "next/server";
import { getProviderFor } from "@/lib/email/accounts";
import { cachedThread, upsertEmails } from "@/lib/db";
import type { Email } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Conversation view data: GET /api/threads/{account}/{threadId} (the param is
 * the account-qualified thread id, URL-encoded). Uses server-side threading
 * when the provider supports it (Gmail), otherwise the local cache — which
 * spans folders, so your own replies (sent) appear alongside received mail.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const decoded = decodeURIComponent(raw);
  const slash = decoded.indexOf("/");
  if (slash <= 0) {
    return NextResponse.json({ error: "account-qualified id が必要です" }, { status: 400 });
  }
  const account = decoded.slice(0, slash);
  const threadId = decoded.slice(slash + 1);

  try {
    let messages: Email[];
    const provider = await getProviderFor(account);
    if (provider.thread) {
      messages = await provider.thread(threadId);
      upsertEmails(account, messages); // keep the cache complete for offline
    } else {
      messages = cachedThread(account, threadId);
    }
    return NextResponse.json({
      messages: messages.map((e) => ({ ...e, account, id: `${account}/${e.id}` })),
    });
  } catch {
    // Provider unreachable → cache fallback.
    const messages = cachedThread(account, threadId);
    return NextResponse.json({
      messages: messages.map((e) => ({ ...e, account, id: `${account}/${e.id}` })),
      stale: true,
    });
  }
}
