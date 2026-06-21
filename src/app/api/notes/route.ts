import { NextResponse } from "next/server";
import { getNote, setNote, listNoteIds } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * 自分用メモ: a private per-email note, kept on the device only and NEVER sent
 * to the AI. GET ?id=… → that note; GET (no id) → the ids that have a note
 * (for the list indicator). POST { id, text } saves (blank text clears).
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) return NextResponse.json({ text: await getNote(id) });
  return NextResponse.json({ ids: await listNoteIds() });
}

export async function POST(req: Request) {
  const { id, text } = (await req.json()) as { id?: string; text?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await setNote(id, typeof text === "string" ? text : "");
  return NextResponse.json({ ok: true });
}
