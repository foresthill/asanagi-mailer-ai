import type { Email } from "@/lib/types";
import { displayName } from "./helpers";

/**
 * Gmail-style flat conversation rows for the list pane: one row per
 * conversation, represented by its newest message (docs/04 §1.6). The list's
 * job is picking which conversation to handle — reading happens in the
 * conversation view — so rows never expand inline (no Thunderbird tree).
 */
export interface ThreadRow {
  /** Newest message of the conversation — select/snippet/date source. */
  email: Email;
  /** How many messages of this conversation are in the current list. */
  count: number;
  /** Participant summary, oldest first — e.g. "佐藤、自分" / "佐藤、田中、他2人". */
  participants: string;
  /** Any member unread → the row reads as unread. */
  unread: boolean;
  /** Any member starred. */
  starred: boolean;
  /** All member ids — thread-unit archive/trash act on every one. */
  ids: string[];
}

/** Group a (newest-first) email list into conversation rows. With grouping
 *  off — or for search results — every mail stays its own row. */
export function buildRows(emails: Email[], grouping: boolean): ThreadRow[] {
  if (!grouping) return emails.map((e) => toRow([e]));
  const groups = new Map<string, Email[]>();
  for (const e of emails) {
    // Thread ids are provider-scoped; qualify with the account to be safe.
    const key = `${e.account ?? ""}|${e.threadId || e.id}`;
    const cur = groups.get(key);
    if (cur) cur.push(e);
    else groups.set(key, [e]);
  }
  // Map preserves insertion order = first (newest) occurrence order.
  return [...groups.values()].map(toRow);
}

function summarize(names: string[]): string {
  return names.length <= 3
    ? names.join("、")
    : `${names.slice(0, 2).join("、")}、他${names.length - 2}人`;
}

function toRow(members: Email[]): ThreadRow {
  const rep = members[0]; // list arrives newest-first
  const names: string[] = [];
  for (const m of [...members].reverse()) {
    // Own replies read as 自分 (sent copies); self-addressed inbox mail
    // keeps the account holder's display name.
    const n = m.state === "sent" ? "自分" : displayName(m.from);
    if (!names.includes(n)) names.push(n);
  }
  let participants = summarize(names);
  // 送信箱: every member is our own mail, so "自分" tells nothing — show
  // who it was sent TO instead (Gmail does the same).
  if (members.every((m) => m.state === "sent")) {
    const recipients: string[] = [];
    for (const m of members)
      for (const a of m.to) {
        const n = a.name || a.email;
        if (n && !recipients.includes(n)) recipients.push(n);
      }
    if (recipients.length) participants = `To: ${summarize(recipients)}`;
  }
  return {
    email: rep,
    count: members.length,
    participants,
    unread: members.some((m) => !m.read),
    starred: members.some((m) => m.starred),
    ids: members.map((m) => m.id),
  };
}
