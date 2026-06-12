import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import type { Email, EmailAddress, MailboxState, OutgoingMessage } from "@/lib/types";
import type { EmailProvider } from "./provider";
import { decodeEntities, repairMojibake } from "./encoding";

/**
 * Generic IMAP (read) + SMTP (send) adapter. Credentials come from the
 * in-app connect settings (stored locally in .data) or env vars — resolved
 * by the provider factory (lib/email/index.ts):
 *   IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD  (defaults to IMAP creds)
 *
 * Folder mapping: inbox=INBOX, archived=Archive, trashed=Trash — override
 * via archiveFolder/trashFolder when your server uses other names.
 */
export interface ImapCreds {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  archiveFolder: string;
  trashFolder: string;
  sentFolder: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
  };
}

/** IMAP/SMTP credentials from env vars, if minimally present. */
export function envImapCreds(): ImapCreds | null {
  const { IMAP_HOST, IMAP_USER, IMAP_PASSWORD } = process.env;
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD) return null;
  return {
    host: IMAP_HOST,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: (process.env.IMAP_SECURE ?? "true") !== "false",
    user: IMAP_USER,
    password: IMAP_PASSWORD,
    archiveFolder: process.env.IMAP_ARCHIVE_FOLDER || "Archive",
    trashFolder: process.env.IMAP_TRASH_FOLDER || "Trash",
    sentFolder: process.env.IMAP_SENT_FOLDER || "Sent",
    smtp: {
      host: process.env.SMTP_HOST || IMAP_HOST,
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: (process.env.SMTP_SECURE ?? "true") !== "false",
      user: process.env.SMTP_USER || IMAP_USER,
      password: process.env.SMTP_PASSWORD || IMAP_PASSWORD,
      from: process.env.SMTP_FROM || IMAP_USER,
    },
  };
}

function addr(a?: { name?: string; address?: string }): EmailAddress {
  return { name: a?.name ? repairMojibake(a.name) : undefined, email: a?.address ?? "" };
}

/** Message-IDs come with or without angle brackets depending on the source
 *  (envelope vs parsed References) — normalize so thread ids compare equal. */
function normId(s?: string | null): string | undefined {
  const t = s?.trim().replace(/^<|>$/g, "");
  return t || undefined;
}

export class ImapProvider implements EmailProvider {
  readonly name = "imap";
  /** Configured names — used as fallbacks; the server's reality wins. */
  private folders: Record<MailboxState, string>;
  /** Server-verified folder map (special-use detection), per instance. */
  private resolvedFolders?: Record<MailboxState, string>;
  /** 受信箱の表示開始日 (YYYY-MM-DD)。これより古い受信メールは返さない。 */
  private inboxCutoff?: string;

  constructor(
    private creds: ImapCreds,
    inboxCutoff?: string,
  ) {
    this.folders = {
      inbox: "INBOX",
      archived: creds.archiveFolder,
      trashed: creds.trashFolder,
      sent: creds.sentFolder,
    };
    this.inboxCutoff = inboxCutoff;
  }

  private connection(): ImapFlow {
    return new ImapFlow({
      host: this.creds.host,
      port: this.creds.port,
      secure: this.creds.secure,
      auth: { user: this.creds.user, pass: this.creds.password },
      logger: false,
    });
  }

  /**
   * Resolve the real folder names from the server (RFC 6154 special-use:
   * \Sent \Trash \Archive). Many servers use e.g. "INBOX.Sent Messages" —
   * appending to a configured-but-missing "Sent" silently loses the copy
   * （送信箱が空に見えた実害の原因）. Explicit setting wins only when the
   * folder actually exists; otherwise special-use, then the configured name.
   */
  private async resolveFolders(c: ImapFlow): Promise<Record<MailboxState, string>> {
    if (this.resolvedFolders) return this.resolvedFolders;
    let boxes: { path: string; specialUse?: string }[] = [];
    try {
      boxes = (await c.list()) as { path: string; specialUse?: string }[];
    } catch {
      return this.folders; // LIST unsupported — behave as before
    }
    const exists = (p: string) => boxes.some((b) => b.path === p);
    const byUse = (use: string) => boxes.find((b) => b.specialUse === use)?.path;
    const pick = (configured: string, use: string) =>
      (exists(configured) ? configured : undefined) ?? byUse(use) ?? configured;
    const sent = pick(this.creds.sentFolder, "\\Sent");
    // No archive anywhere → create one in the same namespace as Sent
    // (e.g. "INBOX.Archive" on INBOX.-prefixed servers).
    let archived = pick(this.creds.archiveFolder, "\\Archive");
    if (!exists(archived)) {
      const ns = sent.includes(".") ? sent.slice(0, sent.lastIndexOf(".") + 1) : "";
      archived = `${ns}${this.creds.archiveFolder}`;
      try {
        await c.mailboxCreate(archived);
      } catch {
        /* exists already or server refuses — moves will surface the error */
      }
    }
    this.resolvedFolders = {
      inbox: "INBOX",
      sent,
      trashed: pick(this.creds.trashFolder, "\\Trash"),
      archived,
    };
    return this.resolvedFolders;
  }

  async list(state: MailboxState): Promise<Email[]> {
    const c = this.connection();
    await c.connect();
    const out: Email[] = [];
    try {
      const folders = await this.resolveFolders(c);
      const lock = await c.getMailboxLock(folders[state]);
      try {
        // Fetch the most recent 50 messages with envelope + source.
        const mailbox = c.mailbox;
        const total = typeof mailbox === "object" ? mailbox.exists : 0;
        const start = Math.max(1, total - 49);
        const range = `${start}:*`;
        for await (const msg of c.fetch(range, {
          envelope: true,
          flags: true,
          bodyStructure: true,
          source: true,
        })) {
          // List payloads stay lean: HTML arrives via get() only.
          out.push({ ...(await this.materialize(msg, state, folders[state])), html: undefined });
        }
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
    // Horizon: pre-cutoff inbox mail stays on the server but out of view,
    // so archiving the visible mail can actually reach inbox zero.
    const cutoffMs =
      state === "inbox" && this.inboxCutoff ? +new Date(this.inboxCutoff) : NaN;
    const visible = Number.isNaN(cutoffMs)
      ? out
      : out.filter((e) => +new Date(e.date) >= cutoffMs);
    return visible.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }

  private async materialize(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msg: any,
    state: MailboxState,
    /** Actual server folder the message lives in (id = `${folder}:${uid}`). */
    folderPath: string,
  ): Promise<Email> {
    const env = msg.envelope ?? {};
    const { text: body, html, refRoot } = await this.parseMime(msg.source);
    const flags: Set<string> = msg.flags ?? new Set();
    return {
      id: `${folderPath}:${msg.uid}`,
      // Thread = first id of the References chain (the conversation root).
      // Compliant clients keep it stable across the whole conversation;
      // In-Reply-To covers clients that only set that header.
      threadId: refRoot ?? normId(env.inReplyTo) ?? normId(env.messageId) ?? String(msg.uid),
      from: addr(env.from?.[0]),
      to: (env.to ?? []).map(addr),
      cc: (env.cc ?? []).map(addr),
      bcc: (env.bcc ?? []).map(addr),
      subject: repairMojibake(env.subject ?? "(件名なし)"),
      snippet: body.slice(0, 140),
      body,
      html,
      date: (env.date ?? new Date()).toISOString?.() ?? new Date(env.date).toISOString(),
      read: flags.has("\\Seen"),
      starred: flags.has("\\Flagged"),
      state,
      messageId: env.messageId,
    };
  }

  /**
   * Proper MIME parsing (multipart, base64/quoted-printable, legacy charsets
   * like ISO-2022-JP) via mailparser. Returns both the plain text (HTML
   * stripped as fallback) and the original HTML when present.
   */
  private async parseMime(
    source?: Buffer,
  ): Promise<{ text: string; html?: string; refRoot?: string }> {
    if (!source) return { text: "" };
    try {
      const parsed = await simpleParser(source, { skipImageLinks: true });
      const html = parsed.html || undefined;
      // Conversation root: References lists ancestors oldest-first.
      const refs = parsed.references;
      const refRoot = normId(Array.isArray(refs) ? refs[0] : refs);
      if (parsed.text?.trim()) return { text: parsed.text.trim(), html, refRoot };
      if (html) {
        const stripped = decodeEntities(
          html
            .replace(/<(br|\/p|\/div|\/tr)\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, ""),
        )
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        return { text: stripped, html, refRoot };
      }
      return { text: "", refRoot };
    } catch {
      // Unparseable message — show the raw tail rather than nothing.
      const raw = source.toString("utf8");
      const idx = raw.search(/\r?\n\r?\n/);
      return { text: idx >= 0 ? raw.slice(idx).trim() : raw };
    }
  }

  /** id = `${folderPath}:${uid}` — split on the LAST colon (paths may vary). */
  private splitId(id: string): { folder: string; uid: string } {
    const i = id.lastIndexOf(":");
    return { folder: id.slice(0, i), uid: id.slice(i + 1) };
  }

  async get(id: string): Promise<Email | null> {
    const { folder, uid } = this.splitId(id);
    const c = this.connection();
    await c.connect();
    try {
      const folders = await this.resolveFolders(c);
      const state =
        (Object.keys(folders) as MailboxState[]).find((s) => folders[s] === folder) ?? "inbox";
      const lock = await c.getMailboxLock(folder);
      try {
        const msg = await c.fetchOne(uid, { envelope: true, flags: true, source: true }, { uid: true });
        return msg ? await this.materialize(msg, state, folder) : null;
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
  }

  /**
   * Full-history server search via IMAP SEARCH, across inbox/archive/sent.
   * From/subject/body run as separate searches and union (binary IMAP OR
   * nesting varies by server). Body search speed depends on the server —
   * acceptable because this only runs on demand.
   */
  async search(query: string, limit = 30): Promise<Email[]> {
    const q = query.trim();
    if (!q) return [];
    const c = this.connection();
    await c.connect();
    const out: Email[] = [];
    try {
      const folders = await this.resolveFolders(c);
      for (const state of ["inbox", "archived", "sent"] as MailboxState[]) {
        try {
          const lock = await c.getMailboxLock(folders[state]);
          try {
            const uids = new Set<number>();
            for (const criteria of [{ from: q }, { subject: q }, { body: q }]) {
              const found = await c.search(criteria, { uid: true });
              for (const u of found || []) uids.add(u);
            }
            // Newest first; cap per folder so one folder can't flood.
            const picked = [...uids].sort((a, b) => b - a).slice(0, limit);
            if (picked.length) {
              for await (const msg of c.fetch(
                picked.join(","),
                { envelope: true, flags: true, bodyStructure: true, source: true },
                { uid: true },
              )) {
                out.push({ ...(await this.materialize(msg, state, folders[state])), html: undefined });
              }
            }
          } finally {
            lock.release();
          }
        } catch {
          /* folder may not exist (e.g. no Archive) — search the rest */
        }
      }
    } finally {
      await c.logout();
    }
    return out
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .slice(0, limit);
  }

  async setState(id: string, state: MailboxState): Promise<void> {
    const { folder, uid } = this.splitId(id);
    const c = this.connection();
    await c.connect();
    try {
      const folders = await this.resolveFolders(c);
      const lock = await c.getMailboxLock(folder);
      try {
        await c.messageMove(uid, folders[state], { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
  }

  async setRead(id: string, read: boolean): Promise<void> {
    const { folder, uid } = this.splitId(id);
    const c = this.connection();
    await c.connect();
    try {
      const lock = await c.getMailboxLock(folder);
      try {
        if (read) await c.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        else await c.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
  }

  async setStarred(id: string, starred: boolean): Promise<void> {
    const { folder, uid } = this.splitId(id);
    const c = this.connection();
    await c.connect();
    try {
      const lock = await c.getMailboxLock(folder);
      try {
        if (starred) await c.messageFlagsAdd(uid, ["\\Flagged"], { uid: true });
        else await c.messageFlagsRemove(uid, ["\\Flagged"], { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
  }

  async remove(id: string): Promise<void> {
    const { folder, uid } = this.splitId(id);
    const c = this.connection();
    await c.connect();
    try {
      const lock = await c.getMailboxLock(folder);
      try {
        await c.messageDelete(uid, { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
  }

  async send(message: OutgoingMessage): Promise<{ messageId?: string; warning?: string }> {
    // Build the RFC822 message once so the copy saved to the Sent folder is
    // byte-identical to what went out. SMTP itself never stores sent mail —
    // without the IMAP APPEND below, sent messages would simply vanish.
    const mail = {
      from: this.creds.smtp.from,
      to: message.to.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)),
      cc: message.cc?.map((a) => a.email),
      bcc: message.bcc?.map((a) => a.email),
      subject: message.subject,
      text: message.body,
      inReplyTo: message.inReplyTo,
      // Keep the conversation root first in References so every depth of the
      // thread resolves to the same root (threadId is that root Message-ID —
      // include it only when it actually looks like one, not a uid fallback).
      references: [
        message.threadId?.includes("@") ? `<${message.threadId.replace(/^<|>$/g, "")}>` : "",
        message.inReplyTo ?? "",
      ].filter((v, i, arr) => v && arr.indexOf(v) === i),
    };
    const raw = await new MailComposer(mail).compile().build();

    const transport = nodemailer.createTransport({
      host: this.creds.smtp.host,
      port: this.creds.smtp.port,
      secure: this.creds.smtp.secure,
      auth: { user: this.creds.smtp.user, pass: this.creds.smtp.password },
    });
    const info = await transport.sendMail({
      envelope: {
        from: this.creds.smtp.from,
        to: [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].map((a) => a.email),
      },
      raw,
    });

    // Save a copy to the Sent folder. Non-fatal: the mail already went out.
    // MailComposer never puts Bcc into the generated message (so recipients
    // can't see it) — re-add it to OUR copy only, as the sending record (証跡).
    let stored = raw;
    if (message.bcc?.length) {
      const headerEnd = raw.indexOf("\r\n\r\n");
      if (headerEnd >= 0) {
        const bccLine = `Bcc: ${message.bcc.map((a) => a.email).join(", ")}\r\n`;
        stored = Buffer.concat([
          raw.subarray(0, headerEnd + 2),
          Buffer.from(bccLine, "utf8"),
          raw.subarray(headerEnd + 2),
        ]);
      }
    }
    // The copy must land in the server's REAL sent folder (special-use
    // detection) — and a failure must be VISIBLE, not swallowed: an empty
    // 送信箱 after sending erodes all trust in the client.
    let warning: string | undefined;
    try {
      const c = this.connection();
      await c.connect();
      try {
        const folders = await this.resolveFolders(c);
        await c.append(folders.sent, stored, ["\\Seen"]);
      } finally {
        await c.logout();
      }
    } catch (e) {
      warning = `送信は完了しましたが、送信箱への控えの保存に失敗しました（${
        e instanceof Error ? e.message : "IMAP append failed"
      }）`;
    }

    return { messageId: info.messageId, warning };
  }
}
