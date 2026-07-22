import { NextResponse } from "next/server";
import { getWritingNote, saveWritingNote } from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET → the user's writing-style rules (文章作成メモ, 返信・添削で使う). */
export async function GET() {
  return NextResponse.json({ note: await getWritingNote() });
}

/** POST { text } → save it. Injected into the reply/suggest prompts. */
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  await saveWritingNote(typeof text === "string" ? text : "");
  return NextResponse.json({ ok: true });
}
