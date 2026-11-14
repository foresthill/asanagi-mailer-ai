import { NextResponse } from "next/server";
import { recordLog, errMsg } from "@/lib/logbuf";
import { getObsidianSettings } from "@/lib/store";
import { isObsidianConfigured, saveNote } from "@/lib/integrations/obsidian";
import type { Email } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Save one email as a Markdown note into the user's Obsidian vault. This is a
 * local file write only (no network) and happens only on the explicit
 * 「Obsidian に保存」action — the body goes to the user's own vault on the same
 * device, never off-device.
 */
export async function POST(req: Request) {
  let body: { email?: Email };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const email = body.email;
  if (!email || !email.id) {
    return NextResponse.json(
      { ok: false, error: "メールが指定されていません。" },
      { status: 400 },
    );
  }

  const s = await getObsidianSettings();
  if (!isObsidianConfigured(s)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Obsidian が未設定です。設定から vault を指定してください。",
      },
      { status: 400 },
    );
  }

  try {
    const { relPath } = await saveNote(s, email);
    recordLog("info", "obsidian", `ノート保存OK ${relPath}`);
    return NextResponse.json({ ok: true, relPath });
  } catch (e) {
    recordLog("error", "obsidian", `ノート保存失敗: ${errMsg(e)}`);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "保存に失敗しました。",
      },
      { status: 200 },
    );
  }
}
