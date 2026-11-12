import { NextResponse } from "next/server";
import {
  getEmailSettings,
  listMailAccounts,
  addMailAccount,
  updateMailAccount,
  removeMailAccount,
  setActiveAccountId,
} from "@/lib/store";
import type { GmailAccountSettings, ImapAccountSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

// Non-secret IMAP fields echoed back so a row can be edited in place.
const IMAP_PLAIN_FIELDS = [
  "fromName",
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
  "inboxCutoff",
] as const;
const IMAP_SECRET_FIELDS = ["password", "smtpPassword"] as const;
// Non-secret Gmail fields echoed back (secrets are flagged, never returned).
const GMAIL_PLAIN_FIELDS = ["address", "inboxCutoff"] as const;

/** Masked, UI-safe view of one account: secrets flagged as set, never echoed. */
function maskAccount(a: Awaited<ReturnType<typeof listMailAccounts>>[number]) {
  if (a.type === "gmail") {
    const g = a.gmail ?? {};
    return {
      id: a.id,
      type: a.type,
      label: a.label,
      address: a.address ?? g.address ?? "",
      connected: Boolean(g.clientId && g.clientSecret && g.refreshToken),
      gmail: {
        ...Object.fromEntries(GMAIL_PLAIN_FIELDS.map((k) => [k, g[k] ?? ""])),
        clientIdSet: Boolean(g.clientId),
        clientSecretSet: Boolean(g.clientSecret),
        refreshTokenSet: Boolean(g.refreshToken),
      },
    };
  }
  const i = a.imap ?? {};
  return {
    id: a.id,
    type: a.type,
    label: a.label,
    address: a.address ?? i.user ?? "",
    connected: Boolean(i.host && i.user && i.password),
    imap: {
      ...Object.fromEntries(IMAP_PLAIN_FIELDS.map((k) => [k, i[k] ?? ""])),
      passwordSet: Boolean(i.password),
      smtpPasswordSet: Boolean(i.smtpPassword),
    },
  };
}

async function maskedList() {
  const [accounts, s] = await Promise.all([
    listMailAccounts(),
    getEmailSettings(),
  ]);
  return {
    accounts: accounts.map(maskAccount),
    // Which account the mailbox shows ("all" = unified). Legacy single-account
    // setups (no accounts[] yet) report "all" so the selector defaults sanely.
    activeAccountId: s.accounts?.length ? (s.activeAccountId ?? "all") : "all",
  };
}

export async function GET() {
  return NextResponse.json(await maskedList());
}

/** Pick only known string fields from an untrusted record (blank = clear). */
function pickFields<T extends string>(
  src: Record<string, unknown> | undefined,
  fields: readonly T[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!src) return out;
  for (const k of fields) {
    const v = src[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function cutoffError(creds: Record<string, string>): string | null {
  const v = creds.inboxCutoff?.trim();
  if (v && !DATE_RE.test(v))
    return "日付は YYYY-MM-DD 形式で指定してください";
  return null;
}

/** POST: add an account. body: { type, label?, address?, imap?/gmail? creds }. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const type = body.type;
  if (type !== "gmail" && type !== "imap") {
    return NextResponse.json({ error: "type は gmail か imap" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label : undefined;
  const address = typeof body.address === "string" ? body.address : undefined;

  if (type === "imap") {
    const imap = pickFields(
      body.imap as Record<string, unknown> | undefined,
      [...IMAP_PLAIN_FIELDS, ...IMAP_SECRET_FIELDS],
    );
    const err = cutoffError(imap);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    if (!imap.host || !imap.user || !imap.password) {
      return NextResponse.json(
        { error: "IMAP はホスト・ユーザー・パスワードが必要です" },
        { status: 400 },
      );
    }
    const account = await addMailAccount({
      type,
      label,
      address,
      imap: imap as Partial<ImapAccountSettings>,
    });
    return NextResponse.json({ ok: true, id: account.id, ...(await maskedList()) });
  }

  // gmail: created with its BYO OAuth client; the refresh token is obtained
  // via the OAuth connect flow (PATCH writes clientId/secret, then the auth
  // route threads this account id through `state`).
  const gmail = pickFields(body.gmail as Record<string, unknown> | undefined, [
    "clientId",
    "clientSecret",
    ...GMAIL_PLAIN_FIELDS,
  ]);
  const err = cutoffError(gmail);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const account = await addMailAccount({
    type,
    label,
    address,
    gmail: gmail as Partial<GmailAccountSettings>,
  });
  return NextResponse.json({ ok: true, id: account.id, ...(await maskedList()) });
}

/** PATCH: edit one account by id. body: { id, label?, address?, imap?/gmail? }. */
export async function PATCH(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  // Switching the mailbox's active account ("all" = unified). This is a
  // settings-level toggle, not an account edit, so it needs no account id.
  if (typeof body.activeAccountId === "string" && body.id === undefined) {
    await setActiveAccountId(body.activeAccountId);
    return NextResponse.json({ ok: true, ...(await maskedList()) });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });

  const patch: Parameters<typeof updateMailAccount>[1] = {};
  if (typeof body.label === "string") patch.label = body.label;
  if (typeof body.address === "string") patch.address = body.address;
  if (body.imap) {
    const imap = pickFields(body.imap as Record<string, unknown>, [
      ...IMAP_PLAIN_FIELDS,
      ...IMAP_SECRET_FIELDS,
    ]);
    const err = cutoffError(imap);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    patch.imap = imap as Partial<ImapAccountSettings>;
  }
  if (body.gmail) {
    const gmail = pickFields(body.gmail as Record<string, unknown>, [
      "clientId",
      "clientSecret",
      "refreshToken",
      ...GMAIL_PLAIN_FIELDS,
    ]);
    const err = cutoffError(gmail);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    patch.gmail = gmail as Partial<GmailAccountSettings>;
  }

  const updated = await updateMailAccount(id, patch);
  if (!updated) {
    return NextResponse.json({ error: "該当アカウントなし" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...(await maskedList()) });
}

/** DELETE: remove one account. ?id=… or body { id }. */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  let id = url.searchParams.get("id") ?? "";
  if (!id) {
    try {
      const body = (await req.json()) as { id?: string };
      id = typeof body.id === "string" ? body.id : "";
    } catch {
      // no body — fall through to the missing-id error
    }
  }
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  await removeMailAccount(id);
  return NextResponse.json({ ok: true, ...(await maskedList()) });
}
