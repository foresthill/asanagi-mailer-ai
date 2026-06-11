import type { EmailProvider } from "./provider";
import { MockProvider } from "./mock";
import { GmailProvider } from "./gmail";
import { ImapProvider } from "./imap";
import { resolveGmailCreds, resolveImapCreds } from "./index";
import { getEmailSettings } from "@/lib/store";

/**
 * Multi-account view over the configured backends. Each configured backend
 * (Gmail, IMAP) is one account; with none configured, the mock is the only
 * account. The settings `active` choice narrows this to a single account
 * ("auto" = all configured).
 */
export interface AccountInfo {
  key: string; // gmail | imap | mock
  label: string;
  address?: string;
}

export async function listAccounts(): Promise<AccountInfo[]> {
  const s = await getEmailSettings();
  const choice =
    (s.active && s.active !== "auto" ? s.active : "") ||
    (process.env.EMAIL_PROVIDER ?? "").toLowerCase();

  const gmail = await resolveGmailCreds();
  const imap = await resolveImapCreds();

  const all: AccountInfo[] = [];
  if (gmail) {
    all.push({ key: "gmail", label: "Gmail", address: s.gmail?.address });
  }
  if (imap) {
    all.push({ key: "imap", label: "IMAP", address: imap.user });
  }
  if (all.length === 0) {
    return [{ key: "mock", label: "デモ", address: "demo@asanagi.local" }];
  }
  if (choice) {
    const chosen = all.filter((a) => a.key === choice);
    if (chosen.length) return chosen;
    if (choice === "mock") return [{ key: "mock", label: "デモ", address: "demo@asanagi.local" }];
  }
  return all;
}

/** Provider instance for a specific account key. */
export async function getProviderFor(key: string): Promise<EmailProvider> {
  switch (key) {
    case "gmail": {
      const creds = await resolveGmailCreds();
      if (!creds) throw new Error("Gmail の資格情報がありません（接続設定を確認）");
      return new GmailProvider(creds);
    }
    case "imap": {
      const creds = await resolveImapCreds();
      if (!creds) throw new Error("IMAP の資格情報がありません（接続設定を確認）");
      return new ImapProvider(creds);
    }
    case "mock":
      return new MockProvider();
    default:
      throw new Error(`不明なアカウント: ${key}`);
  }
}
