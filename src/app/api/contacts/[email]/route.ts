import { NextResponse } from "next/server";
import { contactTimeline, contactTimelineByDomain } from "@/lib/db";
import { listSignals } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Person page data: the full conversation timeline with one address — or, with
 * ?scope=company, everyone at the same @domain (同じ要件で担当が複数に分かれても
 * 1画面で辿れる) — from the local cache, spanning accounts/folders, plus what the
 * importance learner knows about them.
 */
export async function GET(req: Request, ctx: { params: Promise<{ email: string }> }) {
  const { email: raw } = await ctx.params;
  const email = decodeURIComponent(raw).toLowerCase();
  if (!email.includes("@")) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  const domain = email.split("@")[1] ?? "";
  const scope = new URL(req.url).searchParams.get("scope");
  const byCompany = scope === "company" && !!domain;

  const messages = (byCompany ? contactTimelineByDomain(domain) : contactTimeline(email)).map(
    (e) => ({ ...e, id: `${e.account}/${e.id}` }),
  );

  // Learned importance for this sender / their domain (docs/02 signals).
  const signals = await listSignals();
  const learned =
    signals.find((s) => s.kind === "sender" && s.pattern.toLowerCase() === email) ??
    signals.find((s) => s.kind === "domain" && s.pattern.toLowerCase() === domain);

  return NextResponse.json({
    messages,
    learned: learned ? { importance: learned.importance, weight: learned.weight } : null,
  });
}
