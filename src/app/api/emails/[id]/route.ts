import { NextResponse } from "next/server";
import { getProvider } from "@/lib/email";
import { getProviderFor } from "@/lib/email/accounts";
import {
  cachedGet,
  removeCached,
  setJudgmentVerdict,
  updateCached,
  upsertEmails,
} from "@/lib/db";
import {
  recordImportanceFeedback,
  recordThreatReport,
  recordSafeSender,
} from "@/lib/store";
import { projectKeyFromSubject } from "@/lib/importance";
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
  return (
    m.includes("invalid_grant") ||
    m.includes("expired") ||
    m.includes("revoked")
  );
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const { provider, account, id } = await resolve(rawId);
  // Cached body fallback (offline / token expiry / a moved-or-expunged IMAP
  // message whose UID no longer resolves live but is still in our cache).
  const serveCached = () => {
    const cached = account ? cachedGet(account, id) : null;
    if (!cached) return null;
    return NextResponse.json({
      email: { ...cached, account, id: `${account}/${cached.id}` },
      stale: true,
    });
  };
  // Cache-first fast path (?cached=1): return the local copy instantly with no
  // provider round-trip, so the reader paints immediately (and works offline).
  // The client then revalidates live in the background. email:null when we have
  // nothing cached → the client falls through to the live fetch.
  if (new URL(req.url).searchParams.get("cached") === "1") {
    return serveCached() ?? NextResponse.json({ email: null });
  }
  try {
    // Pass the cached Message-ID so IMAP can relocate a mail whose id went stale
    // after archiving (moved folders → new UID) — otherwise its body/attachments
    // vanish and downloads 404.
    const hint = account
      ? (cachedGet(account, id)?.messageId ?? undefined)
      : undefined;
    const email = await provider.get(id, hint);
    // Live lookup miss (e.g. the message was archived/moved so this folder's
    // UID is gone) — serve the cached copy rather than a dead "not found".
    if (!email)
      return (
        serveCached() ??
        NextResponse.json({ error: "not found" }, { status: 404 })
      );
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
    // Cache the full message (incl. html) so the next open is instant and it's
    // readable offline. Raw provider id — must run before we tag the id below.
    if (account) {
      try {
        upsertEmails(account, [email]);
      } catch {
        /* caching is best-effort — never fail the read over it */
      }
    }
    if (account) {
      email.account = account;
      email.id = `${account}/${email.id}`;
    }
    return NextResponse.json({ email });
  } catch (err) {
    // プロバイダ不達でも、本文がキャッシュにあれば見せる（offline/失効耐性）。
    const cached = serveCached();
    if (cached) return cached;
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

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const body = (await req.json()) as {
    state?: MailboxState;
    read?: boolean;
    starred?: boolean;
    importanceFeedback?: { importance: Importance; fromEmail: string };
    reportSpam?: { fromEmail: string };
    markSafe?: { fromEmail: string };
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
      // Teach the per-user knowledge base from explicit feedback. Also learn the
      // project (GitHub repo from the subject) so same-sender-different-project
      // mail (e.g. notifications@github.com) can be judged per repo.
      const subject = account ? cachedGet(account, id)?.subject : undefined;
      await recordImportanceFeedback(
        body.importanceFeedback.fromEmail,
        body.importanceFeedback.importance,
        projectKeyFromSubject(subject),
      );
      // Keep the triage review in sync: feedback given from the reader is
      // the same supervision as a verdict click on the 仕分けレビュー screen.
      if (account) {
        try {
          setJudgmentVerdict(
            account,
            `${account}/${id}`,
            body.importanceFeedback.importance,
          );
        } catch {
          /* judgment log may not exist yet — feedback itself still applies */
        }
      }
    }
    if (body.reportSpam) {
      // 迷惑メール報告: この差出人/ドメインを危険として学習（以降 detectThreat が
      // フラグ）＋重要度も低として学習。移動(ゴミ箱)はクライアントの trash が行う。
      await recordThreatReport(body.reportSpam.fromEmail);
      await recordImportanceFeedback(body.reportSpam.fromEmail, "low");
    }
    if (body.markSafe) {
      // 「問題無し」: 誤検知の打ち消し。安全な差出人として学習する（以降 detectThreat
      // は危険と判定しない）。threat はキャッシュに保存せず一覧応答時に都度算出するため、
      // 次回のリスト取得・再判定で自動的にフラグが外れる（クライアントも即クリア）。
      await recordSafeSender(body.markSafe.fromEmail);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Mirror GET: surface token expiry as 401 so the client shows the reauth
    // prompt instead of a generic failure. Gmail throws `invalid_grant` once
    // the OAuth test-mode refresh token expires (7 days) — reads still work
    // from cache, but writes (setState/setRead/setStarred) fail here.
    const reauth = isAuthError(err);
    return NextResponse.json(
      {
        error: reauth
          ? "Gmailの認証が切れています（接続設定から再認証してください）"
          : err instanceof Error
            ? err.message
            : "failed",
        needsReauth: reauth,
      },
      { status: reauth ? 401 : 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const { provider, account, id } = await resolve(rawId);
  await provider.remove(id);
  if (account) removeCached(account, id);
  return NextResponse.json({ ok: true });
}
