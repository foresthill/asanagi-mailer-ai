import { google, type gmail_v1 } from "googleapis";
import type { Email, EmailAddress, MailboxState, OutgoingMessage } from "@/lib/types";
import type { EmailProvider } from "./provider";
import { decodeEntities, repairMojibake } from "./encoding";

/**
 * Gmail adapter (OAuth2). Credentials come from the in-app connect flow
 * (stored locally in .data) or from env vars — resolution happens in the
 * provider factory (lib/email/index.ts):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 * The in-app flow requests scope gmail.modify only (no permanent delete) —
 * enough for inbox/archive/trash/read/send. remove() needs the full
 * https://mail.google.com/ scope and will fail under gmail.modify.
 */
export interface GmailCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

function client(creds: GmailCreds): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  auth.setCredentials({ refresh_token: creds.refreshToken });
  return google.gmail({ version: "v1", auth });
}

/** Gmail credentials from env vars, if fully present. */
export function envGmailCreds(): GmailCreds | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    return {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      refreshToken: GOOGLE_REFRESH_TOKEN,
    };
  }
  return null;
}

function parseAddress(raw?: string | null): EmailAddress {
  if (!raw) return { email: "" };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || undefined, email: m[2].trim() };
  return { email: raw.trim() };
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

const fromData = (data?: string | null) =>
  data ? Buffer.from(data, "base64").toString("utf8") : "";

/** First part of the given MIME type, walking nested multiparts. */
function findPart(
  payload: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
): string {
  if (!payload) return "";
  if (payload.mimeType === mimeType && payload.body?.data) {
    return fromData(payload.body.data);
  }
  for (const p of payload.parts ?? []) {
    const found = findPart(p, mimeType);
    if (found) return found;
  }
  return "";
}

function decodeBody(payload?: gmail_v1.Schema$MessagePart): string {
  const plain = findPart(payload, "text/plain");
  if (plain) return plain;
  if (payload?.body?.data) return fromData(payload.body.data);
  return "";
}

/** HTML alternative when present (rich rendering in the reader). */
function decodeHtml(payload?: gmail_v1.Schema$MessagePart): string | undefined {
  return findPart(payload, "text/html") || undefined;
}

/** Plain-text fallback for HTML-only mail (list snippets, AI context). */
function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(br|\/p|\/div|\/tr)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function labelFor(state: MailboxState): { add: string[]; remove: string[] } {
  switch (state) {
    case "inbox":
      return { add: ["INBOX"], remove: ["TRASH"] };
    case "archived":
      return { add: [], remove: ["INBOX"] };
    case "trashed":
      return { add: ["TRASH"], remove: ["INBOX"] };
    case "sent":
      // SENT is system-managed; never a target of a user move.
      return { add: [], remove: [] };
  }
}

/** Mailbox state from Gmail labels. Self-addressed mail (SENT+INBOX) counts
 *  as inbox; TRASH wins over everything. */
function stateFromLabels(labels: string[]): MailboxState {
  if (labels.includes("TRASH")) return "trashed";
  if (labels.includes("INBOX")) return "inbox";
  if (labels.includes("SENT")) return "sent";
  return "archived";
}

function toEmail(msg: gmail_v1.Schema$Message): Email {
  const headers = msg.payload?.headers;
  const labels = msg.labelIds ?? [];
  const state = stateFromLabels(labels);
  const html = decodeHtml(msg.payload);
  const body = repairMojibake(decodeBody(msg.payload) || (html ? stripHtml(html) : ""));
  const fixAddr = (a: EmailAddress): EmailAddress =>
    a.name ? { ...a, name: repairMojibake(a.name) } : a;
  return {
    id: msg.id!,
    threadId: msg.threadId ?? msg.id!,
    from: fixAddr(parseAddress(header(headers, "From"))),
    to: (header(headers, "To") ?? "").split(",").filter(Boolean).map(parseAddress).map(fixAddr),
    cc: (header(headers, "Cc") ?? "").split(",").filter(Boolean).map(parseAddress).map(fixAddr),
    // Sent copies keep the Bcc header in Gmail — the sender's record (証跡).
    bcc: (header(headers, "Bcc") ?? "").split(",").filter(Boolean).map(parseAddress).map(fixAddr),
    subject: repairMojibake(header(headers, "Subject") ?? "(件名なし)"),
    // Gmail API snippets arrive HTML-escaped (&gt; etc.) — decode for display.
    snippet: repairMojibake(decodeEntities(msg.snippet ?? "") || body.slice(0, 140)),
    body,
    html,
    date: header(headers, "Date")
      ? new Date(header(headers, "Date")!).toISOString()
      : new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
    read: !labels.includes("UNREAD"),
    starred: labels.includes("STARRED"),
    state,
    messageId: header(headers, "Message-ID"),
  };
}

export class GmailProvider implements EmailProvider {
  readonly name = "gmail";
  private gmail: gmail_v1.Gmail;

  constructor(creds: GmailCreds) {
    this.gmail = client(creds);
  }

  async list(state: MailboxState): Promise<Email[]> {
    const q =
      state === "inbox"
        ? "in:inbox"
        : state === "trashed"
          ? "in:trash"
          : state === "sent"
            ? "in:sent"
            : "-in:inbox -in:trash -in:sent"; // archived: exclude sent too
    const res = await this.gmail.users.messages.list({ userId: "me", q, maxResults: 50 });
    const ids = res.data.messages ?? [];
    const full = await Promise.all(
      ids.map((m) =>
        this.gmail.users.messages.get({ userId: "me", id: m.id!, format: "full" }),
      ),
    );
    return full
      // List payloads stay lean: HTML arrives via get()/thread() only.
      .map((r) => ({ ...toEmail(r.data), html: undefined }))
      .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }

  async get(id: string): Promise<Email | null> {
    const res = await this.gmail.users.messages.get({ userId: "me", id, format: "full" });
    return res.data ? toEmail(res.data) : null;
  }

  /** Server-side conversation: every message of the thread, oldest first. */
  async thread(threadId: string): Promise<Email[]> {
    const res = await this.gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "full",
    });
    return (res.data.messages ?? [])
      .map(toEmail)
      .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }

  async setState(id: string, state: MailboxState): Promise<void> {
    if (state === "trashed") {
      await this.gmail.users.messages.trash({ userId: "me", id });
      return;
    }
    const { add, remove } = labelFor(state);
    await this.gmail.users.messages.modify({
      userId: "me",
      id,
      requestBody: { addLabelIds: add, removeLabelIds: remove },
    });
  }

  async setRead(id: string, read: boolean): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id,
      requestBody: read ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] },
    });
  }

  async setStarred(id: string, starred: boolean): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id,
      requestBody: starred ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] },
    });
  }

  async remove(id: string): Promise<void> {
    await this.gmail.users.messages.delete({ userId: "me", id });
  }

  async send(message: OutgoingMessage): Promise<{ messageId?: string }> {
    // RFC 2047-encode non-ASCII header text (Japanese subjects/names).
    const mimeWord = (s: string) =>
      /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
    const fmt = (list?: EmailAddress[]) =>
      (list ?? []).map((a) => (a.name ? `${mimeWord(a.name)} <${a.email}>` : a.email)).join(", ");

    const headers = [
      `To: ${fmt(message.to)}`,
      message.cc?.length ? `Cc: ${fmt(message.cc)}` : "",
      // Bcc header is honored by the Gmail API, then stripped for recipients.
      message.bcc?.length ? `Bcc: ${fmt(message.bcc)}` : "",
      `Subject: ${mimeWord(message.subject)}`,
      message.inReplyTo ? `In-Reply-To: ${message.inReplyTo}` : "",
      message.inReplyTo ? `References: ${message.inReplyTo}` : "",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
    ].filter(Boolean);

    // Headers and body MUST be separated by a blank line (RFC 5322).
    const rfc822 = headers.join("\r\n") + "\r\n\r\n" + message.body;
    const raw = Buffer.from(rfc822, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    // Gmail threads a reply only when the request carries the threadId in
    // addition to In-Reply-To/References + matching subject.
    // https://developers.google.com/workspace/gmail/api/guides/threads
    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId: message.threadId },
    });
    return { messageId: res.data.id ?? undefined };
  }
}
