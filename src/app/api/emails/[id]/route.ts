import { NextResponse } from "next/server";
import { getProvider } from "@/lib/email";
import { getProviderFor } from "@/lib/email/accounts";
import { cachedGet, removeCached, setJudgmentVerdict, updateCached } from "@/lib/db";
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

/** Gmail OAuth token expiry (OAuthテストは7日失効) → 再認証が必要。 */
function isAuthError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes("invalid_grant") || m.includes("expired") || m.includes("revoked");
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params;
  const { provider, account, id } = await resolve(rawId);
  try {
    const email = await provider.get(id);
    if (!email) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Opening an email marks it read.
    if (!email.read) {
      try {
        await provider.setRead(email.id, true);
        if (account) updateCached(account, email.id, { read: true });
      } catch {
        /* marking read is best-effort */
      }
      email.read = true;
    }
    if (account) {
      email.account = account;
      email.id = `${account}/${email.id}`;
    }
    return NextResponse.json({ email });
  } catch (err) {
    // プロバイダ不達でも、本文がキャッシュにあれば見せる（offline/失効耐性）。
    const cached = account ? cachedGet(account, id) : null;
    if (cached) {
      return NextResponse.json({
        email: { ...cached, account, id: `${account}/${cached.id}` },
        stale: true,
      });
    }
    const reauth = isAuthError(err);
    return NextResponse.json(
      {
        error: reauth
          ? "Gmailの認証が切れています（接続設定から再認証してください）"
          : err instanceof Error
            ? err.message
            : "メールを取得できませんでした",
        needsReauth: reauth,
      },
      { status: reauth ? 401 : 500 },
    );
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params;
  const body = (await req.json()) as {
    state?: MailboxState;
    read?: boolean;
    starred?: boolean;
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
    if (typeof body.starred === "boolean") {
      // Server-side star (Gmail STARRED / IMAP \Flagged) + cache sync.
      await provider.setStarred(id, body.starred);
      if (account) updateCached(account, id, { starred: body.starred });
    }
    if (body.importanceFeedback) {
      // Teach the per-user knowledge base from explicit feedback.
      await recordImportanceFeedback(
        body.importanceFeedback.fromEmail,
        body.importanceFeedback.importance,
      );
      // Keep the triage review in sync: feedback given from the reader is
      // the same supervision as a verdict click on the 仕分けレビュー screen.
      if (account) {
        try {
          setJudgmentVerdict(account, `${account}/${id}`, body.importanceFeedback.importance);
        } catch {
          /* judgment log may not exist yet — feedback itself still applies */
        }
      }
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
