import { NextResponse } from "next/server";
import { getNextcloudSettings, saveNextcloudSettings } from "@/lib/store";
import {
  isNextcloudConfigured,
  normalizeBaseUrl,
} from "@/lib/integrations/nextcloud";
import type { NextcloudSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Never return the raw app-password — only whether it's set and its last 4 chars. */
function maskPw(pw?: string): { set: boolean; last4?: string } {
  if (!pw?.trim()) return { set: false };
  return { set: true, last4: pw.trim().slice(-4) };
}

async function safeView() {
  const s = await getNextcloudSettings();
  return {
    baseUrl: normalizeBaseUrl(s.baseUrl),
    username: s.username ?? "",
    calendarUrl: s.calendarUrl ?? "",
    calendarName: s.calendarName ?? "",
    appPassword: maskPw(s.appPassword),
    configured: isNextcloudConfigured(s),
  };
}

export async function GET() {
  return NextResponse.json(await safeView());
}

export async function POST(req: Request) {
  let body: NextcloudSettings;
  try {
    body = (await req.json()) as NextcloudSettings;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const patch: NextcloudSettings = {};
  if (typeof body.baseUrl === "string") patch.baseUrl = body.baseUrl;
  if (typeof body.username === "string") patch.username = body.username;
  if (typeof body.appPassword === "string")
    patch.appPassword = body.appPassword; // "" clears
  if (typeof body.calendarUrl === "string")
    patch.calendarUrl = body.calendarUrl;
  if (typeof body.calendarName === "string")
    patch.calendarName = body.calendarName;

  await saveNextcloudSettings(patch);
  return NextResponse.json({ ok: true, ...(await safeView()) });
}
