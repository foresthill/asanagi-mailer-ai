import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { listDrafts, saveDraft } from "@/lib/store";
import type { SavedDraft } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/drafts → all saved (unsent) drafts, newest first. */
export async function GET() {
  const drafts = (await listDrafts()).sort(
    (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt),
  );
  return NextResponse.json({ drafts });
}

/**
 * POST /api/drafts → upsert a draft. Body is an OutgoingMessage (+ optional
 * id to update an existing one). Returns the saved draft with its id.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as Partial<SavedDraft>;
  const draft: SavedDraft = {
    id: body.id || randomUUID(),
    to: body.to ?? [],
    cc: body.cc,
    bcc: body.bcc,
    subject: body.subject ?? "",
    body: body.body ?? "",
    // Preserve the rich-HTML alternative and attachments — the composer sends
    // them (outgoing()) and restores them on reopen (openDraft), so dropping
    // them here silently loses attachments/formatting from saved drafts.
    html: body.html,
    attachments: body.attachments,
    inReplyTo: body.inReplyTo,
    threadId: body.threadId,
    account: body.account,
    // Carry the failed-send marker through so a mail auto-retained after a
    // send failure shows up in the sidebar「未送信」alert (and loses the mark
    // only when the draft is deleted on a successful resend).
    failedSend: body.failedSend,
    updatedAt: new Date().toISOString(),
  };
  await saveDraft(draft);
  return NextResponse.json({ ok: true, draft });
}
