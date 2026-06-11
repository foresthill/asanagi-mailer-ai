import { NextResponse } from "next/server";
import { after } from "next/server";
import { getProvider } from "@/lib/email";
import { getProviderFor } from "@/lib/email/accounts";
import { upsertEmails } from "@/lib/db";
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

    // Refresh the sent-folder cache right away (after the response) so the
    // just-sent reply joins its thread and the ↩ replied marker appears
    // without the user having to open 送信箱 first.
    after(async () => {
      try {
        upsertEmails(provider.name, await provider.list("sent"));
      } catch {
        /* cache refresh is best-effort */
      }
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "send failed" },
      { status: 500 },
    );
  }
}
