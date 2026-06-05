import { NextResponse } from "next/server";
import { getProvider } from "@/lib/email";
import type { MailboxState } from "@/lib/types";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = (url.searchParams.get("state") as MailboxState) || "inbox";
  try {
    const emails = await getProvider().list(state);
    return NextResponse.json({ emails });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to list" },
      { status: 500 },
    );
  }
}
