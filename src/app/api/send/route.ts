import { NextResponse } from "next/server";
import { getProvider } from "@/lib/email";
import { getProviderFor } from "@/lib/email/accounts";
import type { OutgoingMessage } from "@/lib/types";

export const maxDuration = 30;

export async function POST(req: Request) {
  const message = (await req.json()) as OutgoingMessage;

  if (!message.to?.length || !message.subject) {
    return NextResponse.json({ error: "to と subject は必須です" }, { status: 400 });
  }

  try {
    // Send from the account the conversation belongs to (reply parity).
    const provider = message.account
      ? await getProviderFor(message.account)
      : await getProvider();
    const result = await provider.send(message);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "send failed" },
      { status: 500 },
    );
  }
}
