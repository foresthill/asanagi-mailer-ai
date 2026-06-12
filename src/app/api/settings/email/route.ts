import { NextResponse } from "next/server";
import { getEmailSettings, saveEmailSettings } from "@/lib/store";
import { getProvider } from "@/lib/email";
import type { EmailSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

const CHOICES = ["auto", "gmail", "imap", "mock"] as const;
type Choice = (typeof CHOICES)[number];

// Non-secret IMAP fields we echo back so the form can be edited in place.
const IMAP_PLAIN_FIELDS = [
  "host",
  "port",
  "secure",
  "user",
  "archiveFolder",
  "trashFolder",
  "sentFolder",
  "smtpHost",
  "smtpPort",
  "smtpSecure",
  "smtpUser",
  "smtpFrom",
] as const;

const IMAP_SECRET_FIELDS = ["password", "smtpPassword"] as const;

/** Settings view for the UI. Secrets are flagged as set, never echoed. */
async function safeView() {
  const s = await getEmailSettings();
  let active = "error";
  try {
    active = (await getProvider()).name;
  } catch {
    // e.g. explicit choice without credentials — surface as not-running
  }
  const g = s.gmail ?? {};
  const i = s.imap ?? {};
  return {
    active, // what actually runs right now
    choice: (s.active ?? "auto") as Choice, // the stored preference
    // Per-account horizon; the stored legacy global acts as the fallback.
    cutoffs: {
      gmail: s.gmail?.inboxCutoff ?? s.inboxCutoff ?? "",
      imap: s.imap?.inboxCutoff ?? s.inboxCutoff ?? "",
    },
    gmail: {
      clientIdSet: Boolean(g.clientId || process.env.GOOGLE_CLIENT_ID),
      clientSecretSet: Boolean(g.clientSecret || process.env.GOOGLE_CLIENT_SECRET),
      connected: Boolean(g.refreshToken || process.env.GOOGLE_REFRESH_TOKEN),
      address: g.address,
    },
    imap: {
      ...Object.fromEntries(IMAP_PLAIN_FIELDS.map((k) => [k, i[k] ?? ""])),
      passwordSet: Boolean(i.password),
      smtpPasswordSet: Boolean(i.smtpPassword),
      envConfigured: Boolean(
        process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD,
      ),
    },
  };
}

export async function GET() {
  return NextResponse.json(await safeView());
}

export async function POST(req: Request) {
  let body: {
    choice?: string;
    inboxCutoff?: string;
    cutoffs?: { gmail?: string; imap?: string };
    gmail?: { clientId?: string; clientSecret?: string };
    imap?: Record<string, string>;
    disconnect?: "gmail" | "imap" | boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const patch: EmailSettings = {};

  if (body.choice && (CHOICES as readonly string[]).includes(body.choice)) {
    patch.active = body.choice as Choice;
  }

  // 受信箱の表示開始日: YYYY-MM-DD のみ受理。空文字 = 制限解除。
  if (typeof body.inboxCutoff === "string") {
    const v = body.inboxCutoff.trim();
    if (v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v)) patch.inboxCutoff = v;
    else return NextResponse.json({ error: "日付は YYYY-MM-DD 形式で指定してください" }, { status: 400 });
  }
  // アカウント別の表示開始日（gmail / imap）。空文字 = そのアカウントの解除。
  if (body.cutoffs) {
    const cur = await getEmailSettings();
    for (const acct of ["gmail", "imap"] as const) {
      const v = body.cutoffs[acct];
      // 未指定のアカウントは現在の実効値（アカウント別 ?? 旧グローバル）を維持。
      const t = (typeof v === "string" ? v : (cur[acct]?.inboxCutoff ?? cur.inboxCutoff ?? "")).trim();
      if (t !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        return NextResponse.json({ error: "日付は YYYY-MM-DD 形式で指定してください" }, { status: 400 });
      }
      patch[acct] = { ...(patch[acct] ?? {}), inboxCutoff: t };
    }
    // 実効値をアカウント別へ確定させたので、紛らわしい旧グローバル値は撤去。
    patch.inboxCutoff = "";
  }

  // disconnect: true (legacy) or "gmail" → drop Gmail token; "imap" → drop creds.
  if (body.disconnect === true || body.disconnect === "gmail") {
    patch.gmail = { refreshToken: "", address: "" };
  } else if (body.disconnect === "imap") {
    patch.imap = Object.fromEntries(
      [...IMAP_PLAIN_FIELDS, ...IMAP_SECRET_FIELDS].map((k) => [k, ""]),
    );
  }

  if (body.gmail) {
    const { clientId, clientSecret } = body.gmail;
    patch.gmail = {
      ...patch.gmail,
      ...(typeof clientId === "string" ? { clientId } : {}),
      ...(typeof clientSecret === "string" ? { clientSecret } : {}),
    };
  }

  if (body.imap && !patch.imap) {
    const imap: Record<string, string> = {};
    for (const k of [...IMAP_PLAIN_FIELDS, ...IMAP_SECRET_FIELDS]) {
      const v = body.imap[k];
      if (typeof v === "string") imap[k] = v; // blank clears (store handles it)
    }
    patch.imap = imap;
  }

  await saveEmailSettings(patch);
  return NextResponse.json({ ok: true, ...(await safeView()) });
}
