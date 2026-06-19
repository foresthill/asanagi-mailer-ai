import { NextResponse } from "next/server";
import { deleteDraft } from "@/lib/store";

export const dynamic = "force-dynamic";

/** DELETE /api/drafts/[id] → remove a saved draft (local only). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteDraft(id);
  return NextResponse.json({ ok: true });
}
