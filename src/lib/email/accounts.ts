import type { EmailProvider } from "./provider";
import { MockProvider } from "./mock";
import { GmailProvider } from "./gmail";
import { ImapProvider } from "./imap";
import {
  resolveGmailCreds,
  resolveImapCreds,
  gmailCredsFrom,
  imapCredsFrom,
} from "./index";
import { getEmailSettings } from "@/lib/store";
import type { EmailSettings, MailAccount } from "@/lib/types";

/**
 * Multi-account view over the configured backends (docs/11). An account is a
 * `MailAccount` with a stable `id` used as the `{account}/{providerId}` prefix.
 *
 * Phase 1: the resolution layer reads a `MailAccount[]`, but the settings file
 * is NOT migrated — if `settings.accounts` is absent we DERIVE the array
 * on-the-fly from the legacy singular `gmail`/`imap` slots, keeping ids
 * "gmail"/"imap" so existing cache (`asanagi.db` account column), drafts and
 * scheduled sends stay valid. Behaviour for the current 1–2 account user is
 * unchanged. Phase 2's "add account" UI is what first writes `settings.accounts`
 * (with arbitrary ids); from then on that array is authoritative.
 */
export interface AccountInfo {
  key: string; // MailAccount.id (legacy: gmail | imap); or mock
  label: string;
  address?: string;
}

/**
 * The accounts in effect: the persisted `accounts[]` when present, else derived
 * from the legacy singular slots (ids "gmail"/"imap", for cache/ID compat).
 * Returns [] when nothing is configured (caller falls back to mock).
 */
export async function deriveAccounts(s: EmailSettings): Promise<MailAccount[]> {
  if (s.accounts?.length) return s.accounts;
  const out: MailAccount[] = [];
  const gmail = await resolveGmailCreds();
  const imap = await resolveImapCreds();
  if (gmail) {
    out.push({ id: "gmail", type: "gmail", label: "Gmail", address: s.gmail?.address, gmail: s.gmail });
  }
  if (imap) {
    out.push({ id: "imap", type: "imap", label: "IMAP", address: imap.user, imap: s.imap });
  }
  return out;
}

const MOCK_ACCOUNT: AccountInfo = { key: "mock", label: "デモ", address: "demo@asanagi.local" };

export async function listAccounts(): Promise<AccountInfo[]> {
  const s = await getEmailSettings();
  const accounts = await deriveAccounts(s);
  if (accounts.length === 0) return [MOCK_ACCOUNT];

  const infos: AccountInfo[] = accounts.map((a) => ({
    key: a.id,
    label: a.label,
    address: a.address,
  }));

  // `active` (legacy singular selector) still narrows to one backend when set to
  // a concrete id. Phase 2 replaces this with activeAccountId ("all" = unified).
  const choice =
    (s.active && s.active !== "auto" ? s.active : "") ||
    (process.env.EMAIL_PROVIDER ?? "").toLowerCase();
  if (choice) {
    const chosen = infos.filter((a) => a.key === choice);
    if (chosen.length) return chosen;
    if (choice === "mock") return [MOCK_ACCOUNT];
  }
  return infos;
}

/** Provider instance for a specific account key (= MailAccount.id). */
export async function getProviderFor(key: string): Promise<EmailProvider> {
  const s = await getEmailSettings();
  if (key === "mock") return new MockProvider();

  // An explicitly-configured account (Phase 2: written by the add-account UI)
  // carries its OWN credentials — build from those, not the legacy singular slot.
  const configured = s.accounts?.find((a) => a.id === key);
  if (configured) {
    if (configured.type === "gmail") {
      const creds = gmailCredsFrom(configured.gmail);
      if (!creds) throw new Error(`Gmail の資格情報がありません（${configured.label}）`);
      return new GmailProvider(creds, configured.gmail?.inboxCutoff ?? s.inboxCutoff);
    }
    const creds = imapCredsFrom(configured.imap);
    if (!creds) throw new Error(`IMAP の資格情報がありません（${configured.label}）`);
    return new ImapProvider(creds, configured.imap?.inboxCutoff ?? s.inboxCutoff);
  }

  // Legacy ids "gmail"/"imap": resolve from the singular slots (+ env fallback),
  // exactly as before — keeps the current single/dual-account setup unchanged.
  switch (key) {
    case "gmail": {
      const creds = await resolveGmailCreds();
      if (!creds) throw new Error("Gmail の資格情報がありません（接続設定を確認）");
      return new GmailProvider(creds, s.gmail?.inboxCutoff ?? s.inboxCutoff);
    }
    case "imap": {
      const creds = await resolveImapCreds();
      if (!creds) throw new Error("IMAP の資格情報がありません（接続設定を確認）");
      return new ImapProvider(creds, s.imap?.inboxCutoff ?? s.inboxCutoff);
    }
    default:
      throw new Error(`不明なアカウント: ${key}`);
  }
}
