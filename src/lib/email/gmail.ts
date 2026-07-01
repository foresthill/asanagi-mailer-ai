import { randomUUID } from "node:crypto";
import { google, type gmail_v1 } from "googleapis";
import type { Attachment, Email, EmailAddress, MailboxState, OutgoingMessage } from "@/lib/types";
import type { EmailProvider } from "./provider";
import { decodeEntities, repairMojibake } from "./encoding";
import { detectJoinUrl, parseIcs } from "./ics";

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

/** Attachments = parts with a filename and an attachmentId, walking nested
 *  multiparts. Inline calendar (.ics) is handled separately as an invite. */
/**
 * Real attachment vs embedded inline image. Inline parts (Content-Disposition:
 * inline, or a Content-ID referenced from the HTML body — newsletter logos
 * etc.) are NOT attachments and must not light up the 📎 indicator.
 */
function isRealAttachmentPart(part: gmail_v1.Schema$MessagePart): boolean {
  const headers = part.headers ?? [];
  const val = (name: string) =>
    headers.find((h) => (h.name ?? "").toLowerCase() === name)?.value?.toLowerCase() ?? "";
  const disp = val("content-disposition");
  if (disp.startsWith("inline")) return false;
  if (disp.startsWith("attachment")) return true;
  // No explicit disposition: a Content-ID means it's embedded in the body.
  return !val("content-id");
}

function collectAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined,
  out: Attachment[] = [],
): Attachment[] {
  if (!payload) return out;
  const filename = payload.filename ?? "";
  const attachmentId = payload.body?.attachmentId;
  if (
    filename &&
    attachmentId &&
    payload.mimeType !== "text/calendar" &&
    isRealAttachmentPart(payload)
  ) {
    out.push({
      id: attachmentId,
      filename: repairMojibake(filename),
      mimeType: payload.mimeType ?? "application/octet-stream",
      size: payload.body?.size ?? undefined,
    });
  }
  for (const p of payload.parts ?? []) collectAttachments(p, out);
  return out;
}

/** Inline images (Content-ID parts referenced from the HTML via `cid:`). */
function collectInlineImages(
  payload: gmail_v1.Schema$MessagePart | undefined,
  out: { cid: string; attachmentId: string; mimeType: string }[] = [],
): { cid: string; attachmentId: string; mimeType: string }[] {
  if (!payload) return out;
  const cid = header(payload.headers ?? undefined, "Content-ID");
  const attachmentId = payload.body?.attachmentId;
  if (cid && attachmentId && (payload.mimeType ?? "").startsWith("image/")) {
    out.push({
      cid: cid.replace(/^<|>$/g, "").trim(),
      attachmentId,
      mimeType: payload.mimeType!,
    });
  }
  for (const p of payload.parts ?? []) collectInlineImages(p, out);
  return out;
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
  // Meeting invite: text/calendar part first (full info), join URL fallback.
  const ics = findPart(msg.payload, "text/calendar") || findPart(msg.payload, "application/ics");
  const invite = ics ? (parseIcs(ics) ?? undefined) : undefined;
  const joinUrl = invite?.joinUrl ?? detectJoinUrl(body);
  const fixAddr = (a: EmailAddress): EmailAddress =>
    a.name ? { ...a, name: repairMojibake(a.name) } : a;
  const attachments = collectAttachments(msg.payload);
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
    invite: invite ?? (joinUrl ? { joinUrl } : undefined),
    attachments,
    hasAttachment: attachments.length > 0,
  };
}

export class GmailProvider implements EmailProvider {
  readonly name = "gmail";
  private gmail: gmail_v1.Gmail;
  /** 受信箱の表示開始日 (YYYY-MM-DD)。Gmail検索の after: に変換。 */
  private inboxCutoff?: string;

  constructor(creds: GmailCreds, inboxCutoff?: string) {
    this.gmail = client(creds);
    this.inboxCutoff = inboxCutoff;
  }

  async list(state: MailboxState): Promise<Email[]> {
    // The horizon keeps a years-deep inbox emptiable: without it, archiving
    // the visible 50 just surfaces the next-older 50, forever (80k+ mails).
    const horizon =
      state === "inbox" && this.inboxCutoff
        ? ` after:${this.inboxCutoff.replace(/-/g, "/")}`
        : "";
    const q =
      (state === "inbox"
        ? "in:inbox"
        : state === "trashed"
          ? "in:trash"
          : state === "sent"
            ? "in:sent"
            : "-in:inbox -in:trash -in:sent") + horizon; // archived: exclude sent too
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
    if (!res.data) return null;
    const email = toEmail(res.data);
    // Embed inline images (cid:) as data URLs so they render in the reader —
    // an iframe can't resolve cid: on its own. Only when the HTML uses them.
    if (email.html?.includes("cid:")) {
      email.html = await this.embedInlineImages(id, res.data.payload ?? undefined, email.html);
    }
    return email;
  }

  /** Replace `cid:` image references in HTML with base64 data URLs. */
  private async embedInlineImages(
    messageId: string,
    payload: gmail_v1.Schema$MessagePart | undefined,
    html: string,
  ): Promise<string> {
    const refs = collectInlineImages(payload).filter((p) => html.includes(`cid:${p.cid}`));
    if (!refs.length) return html;
    const resolved = await Promise.all(
      refs.map(async (p) => {
        try {
          const r = await this.gmail.users.messages.attachments.get({
            userId: "me",
            messageId,
            id: p.attachmentId,
          });
          let b64 = (r.data.data ?? "").replace(/-/g, "+").replace(/_/g, "/");
          while (b64.length % 4) b64 += "=";
          return { cid: p.cid, url: `data:${p.mimeType};base64,${b64}` };
        } catch {
          return null;
        }
      }),
    );
    let out = html;
    for (const r of resolved) {
      if (r) out = out.split(`cid:${r.cid}`).join(r.url);
    }
    return out;
  }

  /** On-demand attachment bytes — never cached locally. */
  async getAttachment(messageId: string, attachmentId: string) {
    // Metadata (filename/mime) lives in the message structure; bytes come
    // from the dedicated attachments endpoint (keeps the message lean).
    const msg = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });
    const meta = collectAttachments(msg.data.payload).find((a) => a.id === attachmentId);
    if (!meta) return null;
    const res = await this.gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });
    const data = res.data.data ?? "";
    return {
      filename: meta.filename,
      mimeType: meta.mimeType,
      content: Buffer.from(data, "base64url"),
    };
  }

  /** Full-history server search — Gmail's own engine, operators included. */
  async search(query: string, limit = 30): Promise<Email[]> {
    const res = await this.gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: limit,
    });
    const ids = res.data.messages ?? [];
    const full = await Promise.all(
      ids.map((m) =>
        this.gmail.users.messages.get({ userId: "me", id: m.id!, format: "full" }),
      ),
    );
    return full
      .map((r) => ({ ...toEmail(r.data), html: undefined }))
      .sort((a, b) => +new Date(b.date) - +new Date(a.date));
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
    ];

    const atts = message.attachments ?? [];
    const inlineAtts = atts.filter((a) => a.cid); // → multipart/related (cid)
    const regularAtts = atts.filter((a) => !a.cid); // → multipart/mixed
    const wrap = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n");
    const b64 = (s: string) => wrap(Buffer.from(s, "utf8").toString("base64"));

    // Each helper returns a full MIME "part" (headers + blank line + body), so
    // parts nest uniformly: a multipart's body is just other parts.
    const leafText = () =>
      `Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(message.body)}`;
    const leafHtml = () =>
      `Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(message.html ?? "")}`;
    const leafAtt = (a: (typeof atts)[number]) =>
      `Content-Type: ${a.mimeType}; name="${mimeWord(a.filename)}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${mimeWord(a.filename)}"\r\n\r\n${wrap(a.content)}`;
    const leafInline = (a: (typeof atts)[number]) =>
      `Content-Type: ${a.mimeType}\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <${a.cid}>\r\nContent-Disposition: inline; filename="${mimeWord(a.filename)}"\r\n\r\n${wrap(a.content)}`;
    const multipart = (subtype: string, parts: string[]) => {
      const b = `=_${subtype}_${randomUUID()}`;
      return (
        `Content-Type: multipart/${subtype}; boundary="${b}"\r\n\r\n` +
        parts.flatMap((p) => [`--${b}`, p]).join("\r\n") +
        `\r\n--${b}--\r\n`
      );
    };

    let rfc822: string;
    if (!message.html && atts.length === 0) {
      // text/plain — unchanged simple path (keeps threading parity, raw body).
      headers.push('Content-Type: text/plain; charset="UTF-8"');
      rfc822 = headers.filter(Boolean).join("\r\n") + "\r\n\r\n" + message.body;
    } else {
      // Build bottom-up: [related(html, inline imgs)] → alternative(text, html)
      // → mixed(body, regular attachments). Each layer is added only if needed.
      const htmlNode = message.html
        ? inlineAtts.length
          ? multipart("related", [leafHtml(), ...inlineAtts.map(leafInline)])
          : leafHtml()
        : null;
      let bodyNode = htmlNode ? multipart("alternative", [leafText(), htmlNode]) : leafText();
      if (regularAtts.length) {
        bodyNode = multipart("mixed", [bodyNode, ...regularAtts.map(leafAtt)]);
      }
      // bodyNode already starts with its own Content-Type header.
      rfc822 = headers.filter(Boolean).join("\r\n") + "\r\n" + bodyNode;
    }

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
