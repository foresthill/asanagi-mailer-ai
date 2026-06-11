import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { Email, EmailAddress, MailboxState, OutgoingMessage } from "@/lib/types";
import type { EmailProvider } from "./provider";
import { repairMojibake } from "./encoding";

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

export class ImapProvider implements EmailProvider {
  readonly name = "imap";
  private folders: Record<MailboxState, string>;

  constructor(private creds: ImapCreds) {
    this.folders = {
      inbox: "INBOX",
      archived: creds.archiveFolder,
      trashed: creds.trashFolder,
      sent: creds.sentFolder,
    };
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

  async list(state: MailboxState): Promise<Email[]> {
    const c = this.connection();
    await c.connect();
    const out: Email[] = [];
    try {
      const lock = await c.getMailboxLock(this.folders[state]);
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
          out.push(await this.materialize(msg, state));
        }
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
    return out.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }

  private async materialize(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msg: any,
    state: MailboxState,
  ): Promise<Email> {
    const env = msg.envelope ?? {};
    const body = await this.parseBody(msg.source);
    const flags: Set<string> = msg.flags ?? new Set();
    return {
      id: `${this.folders[state]}:${msg.uid}`,
      threadId: env.messageId ?? String(msg.uid),
      from: addr(env.from?.[0]),
      to: (env.to ?? []).map(addr),
      cc: (env.cc ?? []).map(addr),
      subject: repairMojibake(env.subject ?? "(件名なし)"),
      snippet: body.slice(0, 140),
      body,
      date: (env.date ?? new Date()).toISOString?.() ?? new Date(env.date).toISOString(),
      read: flags.has("\\Seen"),
      state,
      messageId: env.messageId,
    };
  }

  private async parseBody(source?: Buffer): Promise<string> {
    if (!source) return "";
    // Minimal text extraction: take the text/plain section if present.
    const raw = source.toString("utf8");
    const idx = raw.search(/\r?\n\r?\n/);
    return idx >= 0 ? raw.slice(idx).trim() : raw;
  }

  async get(id: string): Promise<Email | null> {
    const [folder, uid] = id.split(":");
    const state =
      (Object.keys(this.folders) as MailboxState[]).find((s) => this.folders[s] === folder) ??
      "inbox";
    const c = this.connection();
    await c.connect();
    try {
      const lock = await c.getMailboxLock(folder);
      try {
        const msg = await c.fetchOne(uid, { envelope: true, flags: true, source: true }, { uid: true });
        return msg ? await this.materialize(msg, state) : null;
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
  }

  async setState(id: string, state: MailboxState): Promise<void> {
    const [folder, uid] = id.split(":");
    const c = this.connection();
    await c.connect();
    try {
      const lock = await c.getMailboxLock(folder);
      try {
        await c.messageMove(uid, this.folders[state], { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
  }

  async setRead(id: string, read: boolean): Promise<void> {
    const [folder, uid] = id.split(":");
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

  async remove(id: string): Promise<void> {
    const [folder, uid] = id.split(":");
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

  async send(message: OutgoingMessage): Promise<{ messageId?: string }> {
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
      references: message.inReplyTo,
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
    try {
      const c = this.connection();
      await c.connect();
      try {
        await c.append(this.folders.sent, raw, ["\\Seen"]);
      } finally {
        await c.logout();
      }
    } catch {
      /* Sent folder missing or append unsupported — sending still succeeded */
    }

    return { messageId: info.messageId };
  }
}
