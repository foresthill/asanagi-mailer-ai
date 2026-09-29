import { NextResponse } from "next/server";
import {
  listExcludedProjects,
  removeExcludedProject,
  clearExcludedProjects,
} from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET → the learned "excluded projects" list (for a manage/reset UI). */
export async function GET() {
  return NextResponse.json({ excluded: await listExcludedProjects() });
}

/**
 * DELETE → reset the exclusion learning. `?key=...` removes one; no key clears all.
 * After reset, excluded projects reappear on the next hub regeneration.
 */
export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (key) {
    return NextResponse.json({ excluded: await removeExcludedProject(key) });
  }
  await clearExcludedProjects();
  return NextResponse.json({ excluded: [] });
}
