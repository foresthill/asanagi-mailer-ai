import { NextResponse } from "next/server";
import { google } from "googleapis";
import { resolveGmailCreds } from "@/lib/email";
import { setTodoGcalEvent } from "@/lib/store";

export const maxDuration = 30;

/**
 * Add a TODO's due time to Google Calendar (primary), reusing the connected
 * Gmail OAuth. `start` is an ISO datetime; a 30-min event is created. Idempotent
 * via a stable iCalUID derived from todoId (re-adding overwrites, not duplicates).
 * Missing calendar scope → 403 needsReauth (the UI guides re-connect).
 */
export async function POST(req: Request) {
  let body: {
    title?: string;
    description?: string;
    start?: string;
    todoId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const start = (body.start ?? "").trim();
  if (!title || !start) {
    return NextResponse.json(
      { ok: false, error: "件名と日時が必要です。" },
      { status: 400 },
    );
  }
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) {
    return NextResponse.json(
      { ok: false, error: "日時が不正です。" },
      { status: 400 },
    );
  }

  const creds = await resolveGmailCreds();
  if (!creds) {
    return NextResponse.json(
      {
        ok: false,
        error: "Googleカレンダーを使うにはGmail（Google）接続が必要です",
        needsReauth: true,
      },
      { status: 400 },
    );
  }

  try {
    const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
    auth.setCredentials({ refresh_token: creds.refreshToken });
    const calendar = google.calendar({ version: "v3", auth });

    const end = new Date(startDate.getTime() + 30 * 60 * 1000);
    const event = {
      summary: title,
      description: body.description,
      start: { dateTime: startDate.toISOString() },
      end: { dateTime: end.toISOString() },
    };

    // Stable iCalUID per todo so re-adding updates the same event (no dupes).
    const res = body.todoId
      ? await calendar.events.import({
          calendarId: "primary",
          requestBody: {
            ...event,
            iCalUID: `asanagi-todo-${body.todoId}`,
          },
        })
      : await calendar.events.insert({
          calendarId: "primary",
          requestBody: event,
        });

    if (body.todoId && res.data.id) {
      await setTodoGcalEvent(
        body.todoId,
        res.data.id,
        res.data.htmlLink ?? undefined,
      );
    }
    return NextResponse.json({
      ok: true,
      eventId: res.data.id,
      htmlLink: res.data.htmlLink,
    });
  } catch (err) {
    const e = err as { code?: number; message?: string };
    if (e.code === 403) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "カレンダーへの権限がありません。接続設定から「Googleで認証して接続」をやり直すと、カレンダー権限付きで再接続されます（Google CloudでCalendar APIの有効化も必要です）",
          needsReauth: true,
        },
        { status: 200 },
      );
    }
    return NextResponse.json(
      { ok: false, error: e.message ?? "カレンダー登録に失敗しました" },
      { status: 200 },
    );
  }
}
