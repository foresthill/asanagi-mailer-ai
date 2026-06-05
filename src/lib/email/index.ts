import type { EmailProvider } from "./provider";
import { MockProvider } from "./mock";
import { GmailProvider, gmailConfigured } from "./gmail";
import { ImapProvider, imapConfigured } from "./imap";

let cached: EmailProvider | null = null;

/**
 * Pick the active email backend from env, newest-credential wins:
 *   EMAIL_PROVIDER = gmail | imap | mock   (explicit override)
 * Otherwise auto-detect by available credentials, falling back to the
 * mock provider so the app always runs.
 */
export function getProvider(): EmailProvider {
  if (cached) return cached;

  const explicit = (process.env.EMAIL_PROVIDER ?? "").toLowerCase();
  if (explicit === "gmail" || (!explicit && gmailConfigured())) {
    cached = new GmailProvider();
  } else if (explicit === "imap" || (!explicit && imapConfigured())) {
    cached = new ImapProvider();
  } else {
    cached = new MockProvider();
  }
  return cached;
}

export type { EmailProvider };
