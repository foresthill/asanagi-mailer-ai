import { NextResponse } from "next/server";
import { getDevlogSettings, setTodoDevlogLink } from "@/lib/store";
import { createIssue, isDevlogConfigured } from "@/lib/integrations/devlog";

export const dynamic = "force-dynamic";

/**
 * Create a devlog issue from a mail / todo. The description is built client-side
 * (subject, sender, date, excerpt). When `todoId` is given, the created issue is
 * linked back onto that todo (key + URL). Nothing is sent unless the user presses
 * the button; the issue goes to the user's own devlog instance.
 */
export async function POST(req: Request) {
  let body: { title?: string; description?: string; todoId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  if (!title) {
    return NextResponse.json(
      { ok: false, error: "件名がありません。" },
      { status: 400 },
    );
  }

  const settings = await getDevlogSettings();
  if (!isDevlogConfigured(settings) || !settings.projectKey) {
    return NextResponse.json(
      { ok: false, error: "devlog が未設定です。設定から接続してください。" },
      { status: 400 },
    );
  }

  try {
    const issue = await createIssue(settings, {
      title,
      description: body.description,
    });
    if (body.todoId) {
      await setTodoDevlogLink(body.todoId, issue.issueKey, issue.url);
    }
    return NextResponse.json({ ok: true, key: issue.issueKey, url: issue.url });
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
