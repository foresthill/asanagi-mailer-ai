import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import {
  getEmailSettings,
  saveEmailSettings,
  listMailAccounts,
  updateMailAccount,
} from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * OAuth callback: verify state, exchange the code for tokens, persist the
 * refresh token locally (.data), and bounce back to the app.
 *
 * If a `gmail_oauth_account` cookie is present (multi-account, docs/11) the
 * token is written onto THAT MailAccount; otherwise the legacy single-slot
 * (s.gmail) path runs unchanged.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/?gmail_error=${encodeURIComponent(reason)}`);

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get("gmail_oauth_state")?.value;
  if (!code) return fail(req.nextUrl.searchParams.get("error") ?? "no_code");
  if (!state || !expected || state !== expected) return fail("state_mismatch");

  const accountId = req.cookies.get("gmail_oauth_account")?.value || "";
  const s = await getEmailSettings();

  // Resolve the client used for the token exchange: the target account's own
  // client when present, else the legacy single slot / env.
  let clientId = s.gmail?.clientId || process.env.GOOGLE_CLIENT_ID;
  let clientSecret = s.gmail?.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
  if (accountId) {
    const account = (await listMailAccounts()).find((a) => a.id === accountId);
    clientId = account?.gmail?.clientId || clientId;
    clientSecret = account?.gmail?.clientSecret || clientSecret;
  }
  if (!clientId || !clientSecret) return fail("client_missing");

  const redirectUri = `${origin}/api/auth/google/callback`;
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  try {
    const { tokens } = await auth.getToken(code);
    if (!tokens.refresh_token) return fail("no_refresh_token");
    auth.setCredentials(tokens);

    // Resolve the connected address for display.
    const gmail = google.gmail({ version: "v1", auth });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const address = profile.data.emailAddress ?? undefined;

    if (accountId) {
      // Multi-account: write the token onto the targeted account.
      await updateMailAccount(accountId, {
        address,
        gmail: { refreshToken: tokens.refresh_token, address: address ?? "" },
      });
    } else {
      await saveEmailSettings({
        gmail: { refreshToken: tokens.refresh_token, address: address ?? undefined },
      });
    }

    const res = NextResponse.redirect(`${origin}/?gmail=connected`);
    res.cookies.delete("gmail_oauth_state");
    res.cookies.delete("gmail_oauth_account");
    return res;
  } catch (err) {
    return fail(err instanceof Error ? err.message.slice(0, 120) : "token_exchange_failed");
  }
}
