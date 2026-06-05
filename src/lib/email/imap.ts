import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { Email, EmailAddress, MailboxState, OutgoingMessage } from "@/lib/types";
import type { EmailProvider } from "./provider";

/**
 * Generic IMAP (read) + SMTP (send) adapter. Activates when these are set:
 *   IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD  (defaults to IMAP creds)
 *
 * Folder mapping: inbox=INBOX, archived=Archive, trashed=Trash. Override with
 *   IMAP_ARCHIVE_FOLDER / IMAP_TRASH_FOLDER if your server uses other names.
 */
export function imapConfigured(): boolean {
  return Boolean(
    process.env.IMAP_HOST &&
      process.env.IMAP_USER &&
      process.env.IMAP_PASSWORD,
  );
}

const FOLDERS: Record<MailboxState, string> = {
  inbox: "INBOX",
  archived: process.env.IMAP_ARCHIVE_FOLDER || "Archive",
  trashed: process.env.IMAP_TRASH_FOLDER || "Trash",
};

function connection(): ImapFlow {
  return new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: (process.env.IMAP_SECURE ?? "true") !== "false",
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  });
}

function addr(a?: { name?: string; address?: string }): EmailAddress {
  return { name: a?.name || undefined, email: a?.address ?? "" };
}

export class ImapProvider implements EmailProvider {
  readonly name = "imap";

  async list(state: MailboxState): Promise<Email[]> {
    const c = connection();
    await c.connect();
    const out: Email[] = [];
    try {
      const lock = await c.getMailboxLock(FOLDERS[state]);
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
      id: `${FOLDERS[state]}:${msg.uid}`,
      threadId: env.messageId ?? String(msg.uid),
      from: addr(env.from?.[0]),
      to: (env.to ?? []).map(addr),
      cc: (env.cc ?? []).map(addr),
      subject: env.subject ?? "(件名なし)",
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
    const state = (Object.keys(FOLDERS) as MailboxState[]).find((s) => FOLDERS[s] === folder) ?? "inbox";
    const c = connection();
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
    const c = connection();
    await c.connect();
    try {
      const lock = await c.getMailboxLock(folder);
      try {
        await c.messageMove(uid, FOLDERS[state], { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
  }

  async setRead(id: string, read: boolean): Promise<void> {
    const [folder, uid] = id.split(":");
    const c = connection();
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
    const c = connection();
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
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || process.env.IMAP_HOST,
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: (process.env.SMTP_SECURE ?? "true") !== "false",
      auth: {
        user: process.env.SMTP_USER || process.env.IMAP_USER!,
        pass: process.env.SMTP_PASSWORD || process.env.IMAP_PASSWORD!,
      },
    });
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.IMAP_USER,
      to: message.to.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)),
      cc: message.cc?.map((a) => a.email),
      subject: message.subject,
      text: message.body,
      inReplyTo: message.inReplyTo,
      references: message.inReplyTo,
    });
    return { messageId: info.messageId };
  }
}
