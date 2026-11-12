import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { ImapCreds } from "./imap";
import { recordLog, errMsg } from "@/lib/logbuf";

export interface ConnectivityResult {
  ok: boolean;
  imap: { ok: boolean; total?: number; error?: string };
  smtp: { ok: boolean; error?: string };
}

/**
 * Verify resolved IMAP/SMTP creds actually work: log in to IMAP and open INBOX
 * (returns the message count), then verify the SMTP login — without sending.
 * Shared by the active-provider test and the per-account test routes.
 */
export async function testImapCreds(
  creds: ImapCreds,
): Promise<ConnectivityResult> {
  const result: ConnectivityResult = {
    ok: false,
    imap: { ok: false },
    smtp: { ok: false },
  };

  // IMAP: connect + open INBOX.
  try {
    const c = new ImapFlow({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      auth: { user: creds.user, pass: creds.password },
      logger: false,
    });
    await c.connect();
    try {
      const lock = await c.getMailboxLock("INBOX");
      try {
        const mailbox = c.mailbox;
        result.imap = {
          ok: true,
          total: typeof mailbox === "object" ? mailbox.exists : undefined,
        };
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
    recordLog(
      "info",
      "imap",
      `接続OK ${creds.host}:${creds.port} (secure=${creds.secure}) total=${result.imap.total ?? "?"}`,
    );
  } catch (err) {
    result.imap = {
      ok: false,
      error: err instanceof Error ? err.message : "IMAP接続失敗",
    };
    recordLog(
      "error",
      "imap",
      `接続失敗 ${creds.host}:${creds.port} (secure=${creds.secure}): ${errMsg(err)}`,
    );
  }

  // SMTP: verify login/connection without sending.
  try {
    const transport = nodemailer.createTransport({
      host: creds.smtp.host,
      port: creds.smtp.port,
      secure: creds.smtp.secure,
      auth: { user: creds.smtp.user, pass: creds.smtp.password },
    });
    await transport.verify();
    result.smtp = { ok: true };
    recordLog(
      "info",
      "smtp",
      `接続OK ${creds.smtp.host}:${creds.smtp.port} (secure=${creds.smtp.secure})`,
    );
  } catch (err) {
    result.smtp = {
      ok: false,
      error: err instanceof Error ? err.message : "SMTP接続失敗",
    };
    recordLog(
      "error",
      "smtp",
      `接続失敗 ${creds.smtp.host}:${creds.smtp.port} (secure=${creds.smtp.secure}): ${errMsg(err)}`,
    );
  }

  result.ok = result.imap.ok && result.smtp.ok;
  return result;
}
