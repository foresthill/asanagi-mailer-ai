import { NextResponse } from "next/server";
import {
  getAiCache,
  saveAiCache,
  deleteAiCacheItem,
} from "@/lib/store";
import type { AiCacheEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * メールごとのAI出力（訳文・要約）の保存/取得。開き直しても消えないようにする。
 * - GET    ?id=...                  → そのメールの保存済み出力
 * - POST   { id, translations?, summaries? } → マージ保存
 * - DELETE ?id=&kind=translation&key=en      → 保存済み1項目を削除
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  return NextResponse.json({ cache: await getAiCache(id) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | (AiCacheEntry & { id?: string })
    | null;
  if (!body?.id) {
    return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  }
  const patch: AiCacheEntry = {};
  if (body.translations && typeof body.translations === "object")
    patch.translations = body.translations;
  if (body.summaries && typeof body.summaries === "object")
    patch.summaries = body.summaries;
  return NextResponse.json({ ok: true, cache: await saveAiCache(body.id, patch) });
}

export async function DELETE(req: Request) {
  const u = new URL(req.url).searchParams;
  const id = u.get("id");
  const kind = u.get("kind");
  const key = u.get("key");
  if (!id || (kind !== "translation" && kind !== "summary") || !key) {
    return NextResponse.json(
      { error: "id / kind(translation|summary) / key が必要です" },
      { status: 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    cache: await deleteAiCacheItem(id, kind, key),
  });
}
