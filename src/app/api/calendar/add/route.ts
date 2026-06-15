import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getProviderFor } from "@/lib/email/accounts";
import { resolveGmailCreds } from "@/lib/email";

export const maxDuration = 30;

/**
 * 招待メールをGoogleカレンダーへ登録する（docs/05 §3）。
 * POST { id: "{account}/{providerId}" } — サーバ側で当該メールを再取得して
 * ICSを解析（クライアントとICSを往復させない）。events.import + iCalUID で
 * 同じ招待の二重登録を構造的に防ぐ。スコープ不足は needsReauth で返し、
 * UIが再認証へ誘導する。
 */
export async function POST(req: Request) {
  const { id } = (await req.json()) as { id: string };
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });

  const creds = await resolveGmailCreds();
  if (!creds) {
    return NextResponse.json(
      { error: "Googleカレンダーを使うにはGmail（Google）接続が必要です", needsReauth: true },
      { status: 400 },
    );
  }

  const slash = id.indexOf("/");
  const account = slash > 0 ? id.slice(0, slash) : "gmail";
  const rawId = slash > 0 ? id.slice(slash + 1) : id;

  try {
    const provider = await getProviderFor(account);
    const email = await provider.get(rawId);
    const invite = email?.invite;
    if (!invite?.start) {
      return NextResponse.json(
        { error: "このメールから登録可能な会議情報（日時）を取得できませんでした" },
        { status: 422 },
      );
    }

    const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
    auth.setCredentials({ refresh_token: creds.refreshToken });
    const calendar = google.calendar({ version: "v3", auth });

    const time = (iso: string) =>
      invite.allDay ? { date: iso.slice(0, 10) } : { dateTime: iso };
    const description = [
      invite.joinUrl ? `会議URL: ${invite.joinUrl}` : "",
      invite.organizer ? `主催: ${invite.organizer.name ?? ""} <${invite.organizer.email}>` : "",
      "（Asanagi: 招待メールから登録）",
    ]
      .filter(Boolean)
      .join("\n");
    const event = {
      summary: invite.summary ?? email?.subject ?? "会議",
      location: invite.location,
      description,
      start: time(invite.start),
      end: time(invite.end ?? invite.start),
    };

    // iCalUIDがあれば import（同一UIDは同一イベント＝重複しない）。
    const res = invite.uid
      ? await calendar.events.import({
          calendarId: "primary",
          requestBody: { ...event, iCalUID: invite.uid },
        })
      : await calendar.events.insert({ calendarId: "primary", requestBody: event });

    return NextResponse.json({
      ok: true,
      eventId: res.data.id,
      htmlLink: res.data.htmlLink,
    });
  } catch (err) {
    const e = err as { code?: number; message?: string };
    // 403 = calendar.events スコープ未付与（再認証前） / API無効。
    if (e.code === 403) {
      return NextResponse.json(
        {
          error:
            "カレンダーへの権限がありません。接続設定から「Googleで認証して接続」をやり直すと、カレンダー権限付きで再接続されます（Google CloudでCalendar APIの有効化も必要です）",
          needsReauth: true,
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: e.message ?? "カレンダー登録に失敗しました" },
      { status: 500 },
    );
  }
}
