import { NextResponse } from "next/server";
import { after } from "next/server";
import { getProvider } from "@/lib/email";
import { getProviderFor } from "@/lib/email/accounts";
import { upsertEmails } from "@/lib/db";
import { addScheduled, dueScheduled, listScheduled, updateScheduled } from "@/lib/store";
import type { EmailProvider } from "@/lib/email";
import type { OutgoingMessage, ScheduledSend } from "@/lib/types";

/**
 * Flush any sends whose time has arrived. GET runs this on every poll, so it
 * MUST be exactly-once: sending the same scheduled mail twice means a duplicate
 * lands in a real recipient's inbox.
 *
 * Two guards work together:
 *  1. In-process mutex — concurrent GETs (20s poll + re-renders) collapse onto a
 *     single in-flight run instead of each starting their own send loop.
 *  2. Claim-before-send — each item is persisted as "sending" BEFORE the network
 *     send. `dueScheduled()` only returns "scheduled", so an item in flight (or
 *     left "sending" by a crash) is never re-selected and never re-sent.
 */
let flushInFlight: Promise<number> | null = null;

function flushDue(): Promise<number> {
  flushInFlight ??= runFlush().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function runFlush(): Promise<number> {
  const due = await dueScheduled();
  if (!due.length) return 0;
  const sentVia = new Map<string, EmailProvider>();
  for (const item of due) {
    // Claim first: leave the "scheduled" set before any network call so a
    // later flush (or a crash mid-send) can never resend this item.
    await updateScheduled(item.id, { status: "sending" });
    try {
      // Send from the account the item was scheduled for.
      const provider = item.account
        ? await getProviderFor(item.account)
        : await getProvider();
      await provider.send(item);
      sentVia.set(provider.name, provider);
      await updateScheduled(item.id, { status: "sent" });
    } catch (err) {
      await updateScheduled(item.id, {
        status: "failed",
        error: err instanceof Error ? err.message : "send failed",
      });
    }
  }
  // Refresh sent-folder caches so flushed sends join threads/replied marks.
  after(async () => {
    for (const [name, provider] of sentVia) {
      try {
        upsertEmails(name, await provider.list("sent"));
      } catch {
        /* best-effort */
      }
    }
  });
  return due.length;
}

export async function GET() {
  const flushed = await flushDue();
  const items = await listScheduled();
  return NextResponse.json({ items, flushed });
}

export async function POST(req: Request) {
  const { message, sendAt } = (await req.json()) as {
    message: OutgoingMessage;
    sendAt: string;
  };
  if (!message?.to?.length || !sendAt) {
    return NextResponse.json({ error: "message と sendAt は必須です" }, { status: 400 });
  }

  const item: ScheduledSend = {
    ...message,
    id: `sch-${Date.now()}`,
    sendAt,
    status: "scheduled",
    createdAt: new Date().toISOString(),
  };
  await addScheduled(item);
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id は必須です" }, { status: 400 });
  const updated = await updateScheduled(id, { status: "canceled" });
  return NextResponse.json({ ok: Boolean(updated) });
}
