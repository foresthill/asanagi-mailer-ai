import { NextResponse } from "next/server";
import { recordLog, errMsg } from "@/lib/logbuf";
import { getNextcloudSettings, setTodoNcEvent } from "@/lib/store";
import {
  createEvent,
  isNextcloudConfigured,
} from "@/lib/integrations/nextcloud";

export const dynamic = "force-dynamic";

/**
 * Add a calendar event to Nextcloud (from a TODO's due time). `start` is an ISO
 * datetime. When `todoId` is given, the event UID is linked back onto the todo
 * (idempotent: re-adding reuses the same UID so it overwrites, not duplicates).
 * The event goes to the user's own Nextcloud only on this explicit action.
 */
export async function POST(req: Request) {
  let body: {
    title?: string;
    description?: string;
    start?: string;
    todoId?: string;
    uid?: string;
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

  const settings = await getNextcloudSettings();
  if (!isNextcloudConfigured(settings) || !settings.calendarUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: "Nextcloud が未設定です。設定から接続してください。",
      },
      { status: 400 },
    );
  }

  try {
    const { uid } = await createEvent(settings, {
      title,
      description: body.description,
      start,
      uid: body.uid,
    });
    if (body.todoId) await setTodoNcEvent(body.todoId, uid);
    recordLog("info", "nextcloud", `カレンダー登録OK ${uid}`);
    return NextResponse.json({ ok: true, uid });
  } catch (e) {
    recordLog("error", "nextcloud", `カレンダー登録失敗: ${errMsg(e)}`);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "登録に失敗しました。",
      },
      { status: 200 },
    );
  }
}
