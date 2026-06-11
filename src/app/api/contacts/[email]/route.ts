import { NextResponse } from "next/server";
import { contactTimeline } from "@/lib/db";
import { listSignals } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Person page data: the full conversation timeline with one address (from
 * the local cache, spans accounts/folders) plus what the importance learner
 * knows about them.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ email: string }> }) {
  const { email: raw } = await ctx.params;
  const email = decodeURIComponent(raw).toLowerCase();
  if (!email.includes("@")) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const messages = contactTimeline(email).map((e) => ({
    ...e,
    id: `${e.account}/${e.id}`,
  }));

  // Learned importance for this sender / their domain (docs/02 signals).
  const signals = await listSignals();
  const domain = email.split("@")[1] ?? "";
  const learned =
    signals.find((s) => s.kind === "sender" && s.pattern.toLowerCase() === email) ??
    signals.find((s) => s.kind === "domain" && s.pattern.toLowerCase() === domain);

  return NextResponse.json({
    messages,
    learned: learned ? { importance: learned.importance, weight: learned.weight } : null,
  });
}
