import { NextResponse } from "next/server";
import {
  listContactMeta,
  saveContactMeta,
  resolveContactMeta,
} from "@/lib/store";
import type { ContactLabel } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 連絡先メタデータ（ラベル/会社名/敬称/タグ）。local-first: .data にのみ保存。
 * - GET            → 全エントリ（一覧のバッジ用）
 * - GET ?email=... → そのアドレスの解決済みメタ（ドメイン既定＋個人上書き）
 * - POST           → 1件 upsert（scope=domain|person）
 */
export async function GET(req: Request) {
  const email = new URL(req.url).searchParams.get("email");
  if (email) {
    return NextResponse.json({ resolved: await resolveContactMeta(email) });
  }
  return NextResponse.json({ entries: await listContactMeta() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    key?: string;
    scope?: "domain" | "person";
    label?: ContactLabel | null;
    company?: string;
    honorific?: string;
    tags?: string[];
  } | null;
  if (!body?.key || (body.scope !== "domain" && body.scope !== "person")) {
    return NextResponse.json(
      { error: "key と scope が必要です" },
      { status: 400 },
    );
  }
  const entries = await saveContactMeta({
    key: body.key,
    scope: body.scope,
    label: body.label ?? undefined,
    company: body.company,
    honorific: body.honorific,
    tags: body.tags,
    // Saved via the UI = user-confirmed (not an unverified AI suggestion).
    aiSuggested: false,
  });
  return NextResponse.json({ ok: true, entries });
}
