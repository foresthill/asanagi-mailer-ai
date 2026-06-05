import { google, type gmail_v1 } from "googleapis";
import type { Email, EmailAddress, MailboxState, OutgoingMessage } from "@/lib/types";
import type { EmailProvider } from "./provider";

/**
 * Gmail adapter (OAuth2). Activates when these env vars are set:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 * Obtain the refresh token once via the OAuth consent flow with scope
 *   https://mail.google.com/  (or gmail.modify + gmail.send).
 */
function client(): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
}

export function gmailConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN,
  );
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

function decodeBody(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return "";
  const fromData = (data?: string | null) =>
    data ? Buffer.from(data, "base64").toString("utf8") : "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return fromData(payload.body.data);
  }
  if (payload.parts) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return fromData(plain.body.data);
    for (const p of payload.parts) {
      const nested = decodeBody(p);
      if (nested) return nested;
    }
  }
  if (payload.body?.data) return fromData(payload.body.data);
  return "";
}

function labelFor(state: MailboxState): { add: string[]; remove: string[] } {
  switch (state) {
    case "inbox":
      return { add: ["INBOX"], remove: ["TRASH"] };
    case "archived":
      return { add: [], remove: ["INBOX"] };
    case "trashed":
      return { add: ["TRASH"], remove: ["INBOX"] };
  }
}

function toEmail(msg: gmail_v1.Schema$Message): Email {
  const headers = msg.payload?.headers;
  const labels = msg.labelIds ?? [];
  const state: MailboxState = labels.includes("TRASH")
    ? "trashed"
    : labels.includes("INBOX")
      ? "inbox"
      : "archived";
  const body = decodeBody(msg.payload);
  return {
    id: msg.id!,
    threadId: msg.threadId ?? msg.id!,
    from: parseAddress(header(headers, "From")),
    to: (header(headers, "To") ?? "").split(",").filter(Boolean).map(parseAddress),
    cc: (header(headers, "Cc") ?? "").split(",").filter(Boolean).map(parseAddress),
    subject: header(headers, "Subject") ?? "(件名なし)",
    snippet: msg.snippet ?? body.slice(0, 140),
    body,
    date: header(headers, "Date")
      ? new Date(header(headers, "Date")!).toISOString()
      : new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
    read: !labels.includes("UNREAD"),
    state,
    messageId: header(headers, "Message-ID"),
  };
}

export class GmailProvider implements EmailProvider {
  readonly name = "gmail";
  private gmail = client();

  async list(state: MailboxState): Promise<Email[]> {
    const q = state === "inbox" ? "in:inbox" : state === "trashed" ? "in:trash" : "-in:inbox -in:trash";
    const res = await this.gmail.users.messages.list({ userId: "me", q, maxResults: 50 });
    const ids = res.data.messages ?? [];
    const full = await Promise.all(
      ids.map((m) =>
        this.gmail.users.messages.get({ userId: "me", id: m.id!, format: "full" }),
      ),
    );
    return full
      .map((r) => toEmail(r.data))
      .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }

  async get(id: string): Promise<Email | null> {
    const res = await this.gmail.users.messages.get({ userId: "me", id, format: "full" });
    return res.data ? toEmail(res.data) : null;
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

  async remove(id: string): Promise<void> {
    await this.gmail.users.messages.delete({ userId: "me", id });
  }

  async send(message: OutgoingMessage): Promise<{ messageId?: string }> {
    const to = message.to.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
    const lines = [
      `To: ${to}`,
      message.cc?.length ? `Cc: ${message.cc.map((a) => a.email).join(", ")}` : "",
      `Subject: ${message.subject}`,
      message.inReplyTo ? `In-Reply-To: ${message.inReplyTo}` : "",
      message.inReplyTo ? `References: ${message.inReplyTo}` : "",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      message.body,
    ].filter(Boolean);
    const raw = Buffer.from(lines.join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const res = await this.gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    return { messageId: res.data.id ?? undefined };
  }
}
