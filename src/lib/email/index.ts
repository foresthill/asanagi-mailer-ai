import type { EmailProvider } from "./provider";
import { MockProvider } from "./mock";
import { GmailProvider, envGmailCreds, type GmailCreds } from "./gmail";
import { ImapProvider, imapConfigured } from "./imap";
import { getEmailSettings } from "@/lib/store";

/**
 * Resolve Gmail credentials: in-app connect (stored locally) wins over env.
 * The in-app flow may store only clientId/clientSecret (pre-consent) — the
 * connection is usable once refreshToken is present too.
 */
async function gmailCreds(): Promise<GmailCreds | null> {
  const s = await getEmailSettings();
  const g = s.gmail;
  if (g?.clientId && g?.clientSecret && g?.refreshToken) {
    return { clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: g.refreshToken };
  }
  return envGmailCreds();
}

/**
 * Pick the active email backend, async because in-app settings live on disk:
 *   EMAIL_PROVIDER = gmail | imap | mock   (explicit override)
 * Otherwise auto-detect by available credentials (in-app Gmail connect wins),
 * falling back to the mock provider so the app always runs.
 *
 * No module-level cache: settings can change at runtime (connect/disconnect),
 * and constructing providers is cheap (no connection is opened here).
 */
export async function getProvider(): Promise<EmailProvider> {
  const explicit = (process.env.EMAIL_PROVIDER ?? "").toLowerCase();
  const gmail = await gmailCreds();

  if (explicit === "gmail") {
    if (!gmail) throw new Error("EMAIL_PROVIDER=gmail ですが Gmail の資格情報がありません");
    return new GmailProvider(gmail);
  }
  if (explicit === "imap") return new ImapProvider();
  if (explicit === "mock") return new MockProvider();

  if (gmail) return new GmailProvider(gmail);
  if (imapConfigured()) return new ImapProvider();
  return new MockProvider();
}

export type { EmailProvider };
