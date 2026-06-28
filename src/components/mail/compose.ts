import type { Email, EmailAddress, OutgoingAttachment } from "@/lib/types";
import { displayName, fullTime } from "./helpers";

/**
 * Pure helpers that turn (kind, source email) into the composer's initial
 * state. Note: BCC of a received email is never visible to recipients (mail
 * protocol), so "reply all" carries over From + To + Cc only.
 */
export type ComposeKind = "reply" | "replyAll" | "forward" | "new";
export type ComposeAI = "ai" | "plain";

export interface ComposeInit {
  kind: ComposeKind;
  mode: ComposeAI;
  /** Account to send from (and AI/threading context source). */
  account?: string;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  /** Initial body for plain modes ("ai" fetches a draft instead). */
  body: string;
  inReplyTo?: string;
  /** Conversation the reply belongs to (threading — see OutgoingMessage). */
  threadId?: string;
  /** Original email — AI context for replies, quote source for forward. */
  source?: Email;
  /** Conversation so far (oldest first) — extra AI context for drafting. */
  history?: Email[];
  /** ">"-quoted original, appended below the new text (replies only). */
  quote?: string;
  /** Set when editing a saved draft — save updates it, send deletes it. */
  draftId?: string;
  /** Attachments restored when reopening a saved draft. */
  attachments?: OutgoingAttachment[];
}

const KIND_LABEL: Record<ComposeKind, string> = {
  reply: "返信を作成",
  replyAll: "全員に返信",
  forward: "転送",
  new: "新規メール",
};

export function composeTitle(init: ComposeInit): string {
  return init.mode === "ai" ? `AIで${KIND_LABEL[init.kind]}` : KIND_LABEL[init.kind];
}

function rePrefix(subject: string): string {
  return subject.startsWith("Re:") ? subject : `Re: ${subject}`;
}

/**
 * Gmail-style inline quote of the message being replied to — kept below the
 * new text (top-posting) so the recipient retains the conversation context
 * （メールの礼儀）. Existing ">" lines gain another level (">>").
 */
export function quoteOriginal(source: Email): string {
  const attribution = `${fullTime(source.date)} ${displayName(source.from)} <${source.from.email}>:`;
  const quoted = source.body
    .replace(/\r\n?/g, "\n") // CRLF mail bodies would leave stray \r per line
    .trimEnd()
    .split("\n")
    .map((l) => (l.startsWith(">") ? `>${l}` : `> ${l}`))
    .join("\n");
  return `${attribution}\n${quoted}`;
}

/**
 * Split an editable reply draft into the user's own writing (head) and the
 * quoted original (tail). AI 添削 must only ever see/touch the head — the quote
 * is held back so the model can't rewrite it or "complete" the mail with a
 * footer/timestamp it invented (ユーザー要望: 添削は自分の書いた文章だけ).
 *
 * Detection: prefer an exact match of the known `quote`; if the user edited
 * around it, fall back to the structural marker — an attribution line ending
 * with `<addr>:` immediately followed by ">"-quoted lines.
 */
export function splitQuotedDraft(
  body: string,
  quote: string,
): { head: string; tail: string } {
  if (!quote) return { head: body, tail: "" };
  const idx = body.lastIndexOf(quote);
  if (idx >= 0) {
    return { head: body.slice(0, idx).replace(/\s+$/, ""), tail: body.slice(idx) };
  }
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/<[^@\s]+@[^>\s]+>\s*:\s*$/.test(lines[i]) && /^>/.test(lines[i + 1] ?? "")) {
      return {
        head: lines.slice(0, i).join("\n").replace(/\s+$/, ""),
        tail: lines.slice(i).join("\n"),
      };
    }
  }
  return { head: body, tail: "" };
}

/** Everyone on the original mail except our own addresses, de-duplicated. */
function others(list: EmailAddress[] | undefined, self: Set<string>): EmailAddress[] {
  const seen = new Set<string>();
  return (list ?? []).filter((a) => {
    const key = a.email.toLowerCase();
    if (!key || self.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildCompose(
  kind: ComposeKind,
  mode: ComposeAI,
  source?: Email,
  selfAddresses: string[] = [],
): ComposeInit {
  const self = new Set(selfAddresses.map((s) => s.toLowerCase()));

  if (kind === "new" || !source) {
    return { kind: "new", mode: "plain", to: [], cc: [], subject: "", body: "" };
  }

  const base = { account: source.account, source };

  // Replying to a mail WE sent (sent folder) should target its recipients,
  // not ourselves.
  const ownMail = self.has(source.from.email.toLowerCase());
  const replyTo = ownMail ? others(source.to, self) : [source.from];
  const greetTarget = replyTo[0] ?? source.from;

  switch (kind) {
    case "reply":
      return {
        ...base,
        kind,
        mode,
        to: replyTo.length ? replyTo : [source.from],
        cc: [],
        subject: rePrefix(source.subject),
        body: `${displayName(greetTarget)} 様\n\n`,
        inReplyTo: source.messageId,
        threadId: source.threadId,
        quote: quoteOriginal(source),
      };
    case "replyAll": {
      // From + the other To recipients; Cc carried over (minus ourselves).
      const to = others([source.from, ...source.to], self);
      return {
        ...base,
        kind,
        mode,
        to: to.length ? to : [source.from],
        cc: others(source.cc, self),
        subject: rePrefix(source.subject),
        body: `${displayName(to[0] ?? source.from)} 様\n\n`,
        inReplyTo: source.messageId,
        threadId: source.threadId,
        quote: quoteOriginal(source),
      };
    }
    case "forward":
      return {
        ...base,
        kind,
        mode, // "ai" = AI drafts the forwarding note above the quote
        to: [],
        cc: [],
        subject: source.subject.startsWith("Fwd:") ? source.subject : `Fwd: ${source.subject}`,
        body: [
          "",
          "",
          "---------- 転送メッセージ ----------",
          `From: ${displayName(source.from)} <${source.from.email}>`,
          `Date: ${fullTime(source.date)}`,
          `Subject: ${source.subject}`,
          `To: ${source.to.map((a) => a.email).join(", ")}`,
          "",
          source.body,
        ].join("\n"),
      };
  }
}

/**
 * Parse a comma/semicolon separated address line. Supports both bare
 * addresses and the display form `名前 <a@b.c>`.
 */
export function parseAddressList(input: string): EmailAddress[] {
  return input
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*?)<([^>]+)>$/);
      if (m) {
        const name = m[1].trim().replace(/^"|"$/g, "");
        return { name: name || undefined, email: m[2].trim() };
      }
      return { email: part };
    });
}

/** Loose validity check used to enable the send button. */
export function looksLikeAddressList(input: string): boolean {
  const list = parseAddressList(input);
  return list.length > 0 && list.every((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email));
}

/** Display form: `名前 <a@b.c>` when the name is known, bare address otherwise. */
export function formatAddressList(list: EmailAddress[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
}
