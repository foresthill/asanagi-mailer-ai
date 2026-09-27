import { NextResponse } from "next/server";
import { resolveGmailCreds } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * Whether Google Calendar is usable = a Gmail (Google) account is connected.
 * Actual calendar scope is only known when a write is attempted (403 →
 * needsReauth), so this is a best-effort "connected" flag for showing the button.
 */
export async function GET() {
  const creds = await resolveGmailCreds();
  return NextResponse.json({ configured: !!creds });
}
