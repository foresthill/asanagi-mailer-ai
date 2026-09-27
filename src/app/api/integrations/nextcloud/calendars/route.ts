import { NextResponse } from "next/server";
import { getNextcloudSettings } from "@/lib/store";
import { listCalendars, normalizeBaseUrl } from "@/lib/integrations/nextcloud";

export const dynamic = "force-dynamic";

/**
 * Test the connection and list calendars for the settings picker. Accepts an
 * optional { baseUrl, username, appPassword } to verify BEFORE saving; falls back
 * to stored credentials (the app-password is masked in the UI).
 */
export async function POST(req: Request) {
  let body: { baseUrl?: string; username?: string; appPassword?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body = use stored settings */
  }

  const stored = await getNextcloudSettings();
  const baseUrl = normalizeBaseUrl(body.baseUrl ?? stored.baseUrl);
  const username = (body.username?.trim() || stored.username || "").trim();
  const appPassword = (
    body.appPassword?.trim() ||
    stored.appPassword ||
    ""
  ).trim();

  if (!baseUrl || !username || !appPassword) {
    return NextResponse.json(
      {
        ok: false,
        error: "URL・ユーザー名・アプリパスワードを入力してください。",
      },
      { status: 400 },
    );
  }

  try {
    const calendars = await listCalendars(baseUrl, username, appPassword);
    return NextResponse.json({ ok: true, calendars });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "接続に失敗しました。",
      },
      { status: 200 },
    );
  }
}
