import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import { getEmailSettings, saveEmailSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * OAuth callback: verify state, exchange the code for tokens, persist the
 * refresh token locally (.data), and bounce back to the app.
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

  const s = await getEmailSettings();
  const clientId = s.gmail?.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = s.gmail?.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
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

    await saveEmailSettings({
      gmail: {
        refreshToken: tokens.refresh_token,
        address: profile.data.emailAddress ?? undefined,
      },
    });

    const res = NextResponse.redirect(`${origin}/?gmail=connected`);
    res.cookies.delete("gmail_oauth_state");
    return res;
  } catch (err) {
    return fail(err instanceof Error ? err.message.slice(0, 120) : "token_exchange_failed");
  }
}
