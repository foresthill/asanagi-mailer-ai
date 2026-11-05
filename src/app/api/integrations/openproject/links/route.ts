import { NextResponse } from "next/server";

import { getOpenProjectSettings, getOpLinks, listTodos } from "@/lib/store";
import {
  getWorkPackages,
  isOpConfigured,
} from "@/lib/integrations/openproject";
import type { OpWorkPackage } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Given mail/thread keys, return the linked work package (with its *current*
 * status/due) for each key that has one — so the reader can show
 * "OpenProject #123 · In progress · 期限 11/10". This is the read-back half of
 * the integration (mail → WP exists already; this brings the WP state home).
 *
 * A key's WP can come from two places, both keyed the same way:
 *  - openproject-links.json: links recorded when 起票 from the reader
 *  - todos.json (opWorkPackageId): links recorded when filing a TODO
 * Read-only; nothing is written. Missing/forbidden WPs are simply omitted.
 */
export async function GET(req: Request) {
  const keysParam = new URL(req.url).searchParams.get("keys") ?? "";
  const keys = keysParam
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) return NextResponse.json({ ok: true, links: {} });

  const settings = await getOpenProjectSettings();
  if (!isOpConfigured(settings)) {
    return NextResponse.json({ ok: false, links: {} });
  }

  // key → wpId, from either the link map or a TODO filed to OpenProject.
  const keyToWp = new Map<string, { wpId: number; url: string }>();
  const linkMap = await getOpLinks(keys);
  for (const [k, v] of Object.entries(linkMap)) {
    keyToWp.set(k, { wpId: v.wpId, url: v.url });
  }
  const wanted = new Set(keys);
  const todos = await listTodos();
  for (const t of todos) {
    if (
      wanted.has(t.id) &&
      !keyToWp.has(t.id) &&
      t.opWorkPackageId &&
      t.opUrl
    ) {
      const n = Number(t.opWorkPackageId);
      if (Number.isFinite(n) && n > 0) keyToWp.set(t.id, { wpId: n, url: t.opUrl });
    }
  }
  if (keyToWp.size === 0) return NextResponse.json({ ok: true, links: {} });

  // Fetch the current state of each distinct WP, then map back per key.
  const ids = [...new Set([...keyToWp.values()].map((v) => v.wpId))];
  let byId = new Map<number, OpWorkPackage>();
  try {
    const wps = await getWorkPackages(settings, ids);
    byId = new Map(wps.map((w) => [w.id, w]));
  } catch {
    /* offline / auth error → fall back to the stored id+url below */
  }

  const links: Record<string, OpWorkPackage> = {};
  for (const [key, { wpId, url }] of keyToWp) {
    links[key] = byId.get(wpId) ?? { id: wpId, subject: "", url };
  }
  return NextResponse.json({ ok: true, links });
}
