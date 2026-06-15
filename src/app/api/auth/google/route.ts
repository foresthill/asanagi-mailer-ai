import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import { randomUUID } from "node:crypto";
import { getEmailSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Start the Gmail OAuth consent flow with the user's own OAuth client
 * (BYO client, saved in settings or env). Minimal scopes: gmail.modify —
 * read/compose/send/labels/trash, no permanent delete.
 */
export async function GET(req: NextRequest) {
  const s = await getEmailSettings();
  const clientId = s.gmail?.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = s.gmail?.clientSecret || process.env.GOOGLE_CLIENT_SECRET;

  const origin = req.nextUrl.origin;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/?gmail_error=client_missing`);
  }

  const redirectUri = `${origin}/api/auth/google/callback`;
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const state = randomUUID();
  const url = auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // always issue a refresh token
    scope: [
      "https://www.googleapis.com/auth/gmail.modify",
      // 招待メール→カレンダー登録（docs/05）。イベント編集のみの最小権限で、
      // カレンダー全体の管理権限（auth/calendar）は要求しない。
      "https://www.googleapis.com/auth/calendar.events",
    ],
    state,
  });

  const res = NextResponse.redirect(url);
  res.cookies.set("gmail_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
