import { NextResponse } from "next/server";
import { getProvider } from "@/lib/email";
import { getProviderFor } from "@/lib/email/accounts";
import { addScheduled, dueScheduled, listScheduled, updateScheduled } from "@/lib/store";
import type { OutgoingMessage, ScheduledSend } from "@/lib/types";

/** Flush any sends whose time has arrived. Called on every poll (dev cron). */
async function flushDue() {
  const due = await dueScheduled();
  if (!due.length) return 0;
  for (const item of due) {
    try {
      // Send from the account the item was scheduled for.
      const provider = item.account
        ? await getProviderFor(item.account)
        : await getProvider();
      await provider.send(item);
      await updateScheduled(item.id, { status: "sent" });
    } catch (err) {
      await updateScheduled(item.id, {
        status: "failed",
        error: err instanceof Error ? err.message : "send failed",
      });
    }
  }
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
