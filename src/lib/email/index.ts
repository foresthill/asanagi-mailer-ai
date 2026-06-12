import type { EmailProvider } from "./provider";
import { MockProvider } from "./mock";
import { GmailProvider, envGmailCreds, type GmailCreds } from "./gmail";
import { ImapProvider, envImapCreds, type ImapCreds } from "./imap";
import { getEmailSettings } from "@/lib/store";

/**
 * Resolve Gmail credentials: in-app connect (stored locally) wins over env.
 */
export async function resolveGmailCreds(): Promise<GmailCreds | null> {
  const s = await getEmailSettings();
  const g = s.gmail;
  if (g?.clientId && g?.clientSecret && g?.refreshToken) {
    return { clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: g.refreshToken };
  }
  return envGmailCreds();
}

/**
 * Resolve IMAP/SMTP credentials: in-app settings win over env. Blank SMTP
 * fields fall back to the IMAP values (the common single-account case).
 */
export async function resolveImapCreds(): Promise<ImapCreds | null> {
  const s = await getEmailSettings();
  const i = s.imap;
  if (i?.host && i?.user && i?.password) {
    return {
      host: i.host,
      port: Number(i.port || 993),
      secure: i.secure !== "false",
      user: i.user,
      password: i.password,
      archiveFolder: i.archiveFolder || "Archive",
      trashFolder: i.trashFolder || "Trash",
      sentFolder: i.sentFolder || "Sent",
      smtp: {
        host: i.smtpHost || i.host,
        port: Number(i.smtpPort || 465),
        secure: i.smtpSecure !== "false",
        user: i.smtpUser || i.user,
        password: i.smtpPassword || i.password,
        from: i.smtpFrom || i.user,
      },
    };
  }
  return envImapCreds();
}

/**
 * Pick the active email backend, async because in-app settings live on disk.
 * Selection order:
 *   1. in-app choice (settings.active, unless "auto")
 *   2. EMAIL_PROVIDER env override
 *   3. auto-detect by available credentials (gmail > imap > mock)
 *
 * No module-level cache: settings can change at runtime (connect/disconnect/
 * switch), and constructing providers is cheap (no connection opened here).
 */
export async function getProvider(): Promise<EmailProvider> {
  const s = await getEmailSettings();
  const envChoice = (process.env.EMAIL_PROVIDER ?? "").toLowerCase();
  const choice = (s.active && s.active !== "auto" ? s.active : "") || envChoice;

  const gmail = await resolveGmailCreds();
  const imap = await resolveImapCreds();
  // Per-account horizon wins; the legacy app-wide value is the fallback.
  const gmailCutoff = s.gmail?.inboxCutoff ?? s.inboxCutoff;
  const imapCutoff = s.imap?.inboxCutoff ?? s.inboxCutoff;

  if (choice === "gmail") {
    if (!gmail) throw new Error("Gmail が選択されていますが資格情報がありません（接続設定を確認）");
    return new GmailProvider(gmail, gmailCutoff);
  }
  if (choice === "imap") {
    if (!imap) throw new Error("IMAP が選択されていますが資格情報がありません（接続設定を確認）");
    return new ImapProvider(imap, imapCutoff);
  }
  if (choice === "mock") return new MockProvider();

  if (gmail) return new GmailProvider(gmail, gmailCutoff);
  if (imap) return new ImapProvider(imap, imapCutoff);
  return new MockProvider();
}

export type { EmailProvider };
