import { NextResponse } from "next/server";
import { getOpenProjectSettings, setTodoOpLink } from "@/lib/store";
import {
  createWorkPackage,
  isOpConfigured,
} from "@/lib/integrations/openproject";

export const dynamic = "force-dynamic";

/**
 * Create an OpenProject work package from a mail / todo. The description is
 * built client-side (subject, sender, date, excerpt) so this route stays a thin
 * pass-through. When `todoId` is given, the created work package is linked back
 * onto that todo (id + URL) so the row shows "OpenProject #N" and won't be sent
 * twice by accident.
 *
 * The mail excerpt goes to the user's OWN OpenProject instance and only on this
 * explicit action — not an AI provider, so no PII masking here (that would make
 * the work package useless). Nothing is sent unless the user presses the button.
 */
export async function POST(req: Request) {
  let body: { subject?: string; description?: string; todoId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const subject = (body.subject ?? "").trim();
  if (!subject) {
    return NextResponse.json(
      { ok: false, error: "件名がありません。" },
      { status: 400 },
    );
  }

  const settings = await getOpenProjectSettings();
  if (!isOpConfigured(settings) || !settings.projectId) {
    return NextResponse.json(
      {
        ok: false,
        error: "OpenProject が未設定です。設定から接続してください。",
      },
      { status: 400 },
    );
  }

  try {
    const wp = await createWorkPackage(settings, {
      subject,
      description: body.description,
    });
    if (body.todoId) {
      await setTodoOpLink(body.todoId, String(wp.id), wp.url);
    }
    return NextResponse.json({ ok: true, id: wp.id, url: wp.url });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "送信に失敗しました。",
      },
      { status: 200 },
    );
  }
}
