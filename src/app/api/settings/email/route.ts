import { NextResponse } from "next/server";
import { getEmailSettings, saveEmailSettings } from "@/lib/store";
import { getProvider } from "@/lib/email";

export const dynamic = "force-dynamic";

/** Settings view for the UI. Secrets are never echoed back. */
async function safeView() {
  const s = await getEmailSettings();
  const provider = await getProvider();
  const g = s.gmail ?? {};
  return {
    active: provider.name, // gmail | imap | mock
    gmail: {
      clientIdSet: Boolean(g.clientId || process.env.GOOGLE_CLIENT_ID),
      clientSecretSet: Boolean(g.clientSecret || process.env.GOOGLE_CLIENT_SECRET),
      connected: Boolean(g.refreshToken || process.env.GOOGLE_REFRESH_TOKEN),
      address: g.address,
    },
  };
}

export async function GET() {
  return NextResponse.json(await safeView());
}

export async function POST(req: Request) {
  let body: {
    gmail?: { clientId?: string; clientSecret?: string };
    disconnect?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (body.disconnect) {
    // Drop the token + address; keep the OAuth client for easy re-connect.
    await saveEmailSettings({ gmail: { refreshToken: "", address: "" } });
  } else if (body.gmail) {
    const { clientId, clientSecret } = body.gmail;
    await saveEmailSettings({
      gmail: {
        ...(typeof clientId === "string" ? { clientId } : {}),
        ...(typeof clientSecret === "string" ? { clientSecret } : {}),
      },
    });
  }

  return NextResponse.json({ ok: true, ...(await safeView()) });
}
