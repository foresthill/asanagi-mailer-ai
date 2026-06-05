import { NextResponse } from "next/server";
import { getProvider } from "@/lib/email";
import { recordImportanceFeedback } from "@/lib/store";
import type { Importance, MailboxState } from "@/lib/types";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await getProvider().get(decodeURIComponent(id));
  if (!email) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Opening an email marks it read.
  if (!email.read) {
    await getProvider().setRead(email.id, true);
    email.read = true;
  }
  return NextResponse.json({ email });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const realId = decodeURIComponent(id);
  const body = (await req.json()) as {
    state?: MailboxState;
    read?: boolean;
    importanceFeedback?: { importance: Importance; fromEmail: string };
  };
  const provider = getProvider();

  try {
    if (body.state) await provider.setState(realId, body.state);
    if (typeof body.read === "boolean") await provider.setRead(realId, body.read);
    if (body.importanceFeedback) {
      // Teach the per-user knowledge base from explicit feedback.
      await recordImportanceFeedback(
        body.importanceFeedback.fromEmail,
        body.importanceFeedback.importance,
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await getProvider().remove(decodeURIComponent(id));
  return NextResponse.json({ ok: true });
}
