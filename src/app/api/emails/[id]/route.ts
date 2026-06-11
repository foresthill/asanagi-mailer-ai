import { NextResponse } from "next/server";
import { getProvider } from "@/lib/email";
import { getProviderFor } from "@/lib/email/accounts";
import { removeCached, updateCached } from "@/lib/db";
import { recordImportanceFeedback } from "@/lib/store";
import type { EmailProvider } from "@/lib/email";
import type { Importance, MailboxState } from "@/lib/types";

/**
 * API ids are account-qualified (`gmail/18c...`, `imap/INBOX:5`). Split off
 * the account; ids without a prefix fall back to the default provider.
 */
async function resolve(raw: string): Promise<{
  provider: EmailProvider;
  account: string | null;
  id: string;
}> {
  const decoded = decodeURIComponent(raw);
  const slash = decoded.indexOf("/");
  if (slash > 0) {
    const account = decoded.slice(0, slash);
    const id = decoded.slice(slash + 1);
    return { provider: await getProviderFor(account), account, id };
  }
  return { provider: await getProvider(), account: null, id: decoded };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params;
  const { provider, account, id } = await resolve(rawId);
  const email = await provider.get(id);
  if (!email) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Opening an email marks it read.
  if (!email.read) {
    await provider.setRead(email.id, true);
    if (account) updateCached(account, email.id, { read: true });
    email.read = true;
  }
  if (account) {
    email.account = account;
    email.id = `${account}/${email.id}`;
  }
  return NextResponse.json({ email });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params;
  const body = (await req.json()) as {
    state?: MailboxState;
    read?: boolean;
    importanceFeedback?: { importance: Importance; fromEmail: string };
  };
  const { provider, account, id } = await resolve(rawId);

  try {
    if (body.state) {
      await provider.setState(id, body.state);
      if (account) updateCached(account, id, { state: body.state });
    }
    if (typeof body.read === "boolean") {
      await provider.setRead(id, body.read);
      if (account) updateCached(account, id, { read: body.read });
    }
    if (body.importanceFeedback) {
      // Teach the per-user knowledge base from explicit feedback.
      await recordImportanceFeedback(
        body.importanceFeedback.fromEmail,
        body.importanceFeedback.importance,
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params;
  const { provider, account, id } = await resolve(rawId);
  await provider.remove(id);
  if (account) removeCached(account, id);
  return NextResponse.json({ ok: true });
}
