import { NextResponse } from "next/server";
import { getObsidianSettings, saveObsidianSettings } from "@/lib/store";
import {
  isObsidianConfigured,
  normalizeFolder,
  vaultExists,
} from "@/lib/integrations/obsidian";
import type { ObsidianSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

async function safeView() {
  const s = await getObsidianSettings();
  const exists = await vaultExists(s.vaultPath);
  return {
    vaultPath: s.vaultPath ?? "",
    folder: normalizeFolder(s.folder),
    pathExists: exists,
    // 「接続済み」はパス設定済み かつ 実在フォルダ のときだけ（押せば必ず書ける状態）。
    configured: isObsidianConfigured(s) && exists,
  };
}

export async function GET() {
  return NextResponse.json(await safeView());
}

export async function POST(req: Request) {
  let body: ObsidianSettings;
  try {
    body = (await req.json()) as ObsidianSettings;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const patch: ObsidianSettings = {};
  if (typeof body.vaultPath === "string") patch.vaultPath = body.vaultPath;
  if (typeof body.folder === "string") patch.folder = body.folder; // "" clears

  await saveObsidianSettings(patch);
  return NextResponse.json({ ok: true, ...(await safeView()) });
}
