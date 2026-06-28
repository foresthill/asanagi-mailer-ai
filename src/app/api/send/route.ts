import { NextResponse } from "next/server";
import { after } from "next/server";
import { getProvider } from "@/lib/email";
import { getProviderFor } from "@/lib/email/accounts";
import { upsertEmails } from "@/lib/db";
import { attachmentsWithinCap } from "@/lib/attachments";
import type { OutgoingMessage } from "@/lib/types";

export const maxDuration = 30;

export async function POST(req: Request) {
  const message = (await req.json()) as OutgoingMessage;

  if (!message.to?.length || !message.subject) {
    return NextResponse.json({ error: "to と subject は必須です" }, { status: 400 });
  }
  if (!attachmentsWithinCap(message.attachments)) {
    return NextResponse.json(
      { error: "添付ファイルの合計サイズが上限(20MB)を超えています" },
      { status: 413 },
    );
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
    // Gmail OAuthトークン失効（7日失効）を分かりやすく案内し、再認証へ誘導。
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    const reauth =
      msg.includes("invalid_grant") || msg.includes("expired") || msg.includes("revoked");
    return NextResponse.json(
      {
        error: reauth
          ? "Gmailの認証が切れているため送信できませんでした（接続設定から再認証してください）"
          : err instanceof Error
            ? err.message
            : "送信に失敗しました",
        needsReauth: reauth,
      },
      { status: reauth ? 401 : 500 },
    );
  }
}
