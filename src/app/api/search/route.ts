import { NextResponse } from "next/server";
import { searchCached } from "@/lib/db";
import { listSignals } from "@/lib/store";
import { annotateImportance } from "@/lib/importance";

export const dynamic = "force-dynamic";

/**
 * Search the local cache (subject / body / sender), across accounts and
 * folders: GET /api/search?q=keyword+keyword. Searches only cached mail —
 * the index grows as folders are viewed. Server-side (Gmail) search is a
 * later fallback for older, uncached mail.
 */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ emails: [] });

  const signals = await listSignals();
  const emails = annotateImportance(searchCached(q), signals).map((e) => ({
    ...e,
    id: `${e.account}/${e.id}`,
  }));
  return NextResponse.json({ emails });
}
