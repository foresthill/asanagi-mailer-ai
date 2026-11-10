/**
 * Pure helper (no deps → safe for both client and server) to guess the SMTP
 * host from the IMAP host when the user leaves SMTP host blank.
 *
 * Most providers mirror the subdomain (`imap.example.com` → `smtp.example.com`),
 * so using the IMAP host *verbatim* for SMTP (the old fallback) was usually
 * wrong — e.g. lolipop's `imap.lolipop.jp` must become `smtp.lolipop.jp`.
 * If the host doesn't start with `imap.` we can't guess the SMTP name, so we
 * return it unchanged (same as before).
 */
export function deriveSmtpHost(imapHost: string | undefined | null): string {
  const host = (imapHost ?? "").trim();
  if (!host) return "";
  return /^imap\./i.test(host) ? host.replace(/^imap\./i, "smtp.") : host;
}
