import { DatabaseSync } from "node:sqlite";
import { statSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Email, EmailAddress, MailboxState } from "@/lib/types";

/**
 * Local SQLite cache of fetched emails (node:sqlite — no native deps).
 * This is the seed of the local-first source of truth (docs/03):
 *  - serves the unified inbox across accounts
 *  - keeps the UI usable when a provider is unreachable (offline fallback)
 *  - feeds the storage meter
 * Text only (no attachments) and pruned per account, so it stays small.
 */
const DB_PATH = path.join(process.cwd(), ".data", "asanagi.db");

/** Per-account retention: keep this many newest messages. */
export const RETENTION_PER_ACCOUNT = 5000;

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      account     TEXT NOT NULL,
      id          TEXT NOT NULL,
      thread_id   TEXT,
      from_name   TEXT,
      from_email  TEXT,
      to_json     TEXT,
      cc_json     TEXT,
      subject     TEXT,
      snippet     TEXT,
      body        TEXT,
      date        TEXT,
      read        INTEGER,
      state       TEXT,
      message_id  TEXT,
      fetched_at  TEXT,
      PRIMARY KEY (account, id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_acct_state_date
      ON messages (account, state, date DESC);
  `);
  return db;
}

function rowToEmail(r: Record<string, unknown>): Email {
  return {
    id: String(r.id),
    threadId: String(r.thread_id ?? r.id),
    from: { name: (r.from_name as string) || undefined, email: String(r.from_email ?? "") },
    to: JSON.parse(String(r.to_json ?? "[]")) as EmailAddress[],
    cc: JSON.parse(String(r.cc_json ?? "[]")) as EmailAddress[],
    subject: String(r.subject ?? ""),
    snippet: String(r.snippet ?? ""),
    body: String(r.body ?? ""),
    date: String(r.date ?? ""),
    read: Boolean(r.read),
    state: String(r.state) as MailboxState,
    messageId: (r.message_id as string) || undefined,
    account: String(r.account),
  };
}

/** Insert or refresh a batch of fetched emails, then prune old rows. */
export function upsertEmails(account: string, emails: Email[]): void {
  if (!emails.length) return;
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO messages
      (account, id, thread_id, from_name, from_email, to_json, cc_json,
       subject, snippet, body, date, read, state, message_id, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  d.exec("BEGIN");
  try {
    for (const e of emails) {
      stmt.run(
        account,
        e.id,
        e.threadId,
        e.from.name ?? null,
        e.from.email,
        JSON.stringify(e.to ?? []),
        JSON.stringify(e.cc ?? []),
        e.subject,
        e.snippet,
        e.body,
        e.date,
        e.read ? 1 : 0,
        e.state,
        e.messageId ?? null,
        now,
      );
    }
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
  prune(account);
}

/** Drop the oldest rows beyond the per-account retention cap. */
export function prune(account: string, keep = RETENTION_PER_ACCOUNT): void {
  getDb()
    .prepare(
      `DELETE FROM messages WHERE account = ? AND id NOT IN (
         SELECT id FROM messages WHERE account = ? ORDER BY date DESC LIMIT ?
       )`,
    )
    .run(account, account, keep);
}

/** List cached emails for the given accounts and mailbox state, newest first. */
export function cachedList(accounts: string[], state: MailboxState, limit = 100): Email[] {
  if (!accounts.length) return [];
  const marks = accounts.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT * FROM messages WHERE account IN (${marks}) AND state = ?
       ORDER BY date DESC LIMIT ?`,
    )
    .all(...accounts, state, limit) as Record<string, unknown>[];
  return rows.map(rowToEmail);
}

export function cachedGet(account: string, id: string): Email | null {
  const row = getDb()
    .prepare("SELECT * FROM messages WHERE account = ? AND id = ?")
    .get(account, id) as Record<string, unknown> | undefined;
  return row ? rowToEmail(row) : null;
}

/**
 * Which of these conversations contain a message we sent (返信済み判定).
 * Works retroactively: any cached own message in the thread counts.
 */
export function repliedThreadIds(account: string, threadIds: string[]): Set<string> {
  const ids = [...new Set(threadIds)].filter(Boolean);
  if (!ids.length) return new Set();
  const marks = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT thread_id FROM messages
       WHERE account = ? AND state = 'sent' AND thread_id IN (${marks})`,
    )
    .all(account, ...ids) as { thread_id: string }[];
  return new Set(rows.map((r) => String(r.thread_id)));
}

/** Conversation from the local cache (spans folders), oldest first. */
export function cachedThread(account: string, threadId: string): Email[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM messages WHERE account = ? AND thread_id = ? ORDER BY date ASC LIMIT 50",
    )
    .all(account, threadId) as Record<string, unknown>[];
  return rows.map(rowToEmail);
}

/** Keep the cache in sync with provider-side mutations (read/move). */
export function updateCached(
  account: string,
  id: string,
  patch: { state?: MailboxState; read?: boolean },
): void {
  if (patch.state !== undefined) {
    getDb()
      .prepare("UPDATE messages SET state = ? WHERE account = ? AND id = ?")
      .run(patch.state, account, id);
  }
  if (patch.read !== undefined) {
    getDb()
      .prepare("UPDATE messages SET read = ? WHERE account = ? AND id = ?")
      .run(patch.read ? 1 : 0, account, id);
  }
}

export function removeCached(account: string, id: string): void {
  getDb().prepare("DELETE FROM messages WHERE account = ? AND id = ?").run(account, id);
}

/**
 * Full-text-ish search over the cache: subject, body, sender name/address —
 * across accounts and folders. Case-insensitive substring match per keyword
 * (space-separated = AND). LIKE scan is millisecond-class at our retention
 * cap (≤5k rows/account); swap to FTS5+trigram when volume grows.
 */
export function searchCached(query: string, limit = 50): Email[] {
  const terms = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!terms.length) return [];

  const clause = terms
    .map(
      () =>
        `(subject LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
          OR from_name LIKE ? ESCAPE '\\' OR from_email LIKE ? ESCAPE '\\')`,
    )
    .join(" AND ");
  const params = terms.flatMap((t) => {
    const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return [like, like, like, like];
  });

  const rows = getDb()
    .prepare(`SELECT * FROM messages WHERE ${clause} ORDER BY date DESC LIMIT ?`)
    .all(...params, limit) as Record<string, unknown>[];
  return rows.map(rowToEmail);
}

// ---------------------------------------------------------------------------
// Contacts — auto-derived from cached mail, zero manual entry (mini-CRM seed)
// ---------------------------------------------------------------------------

export interface ContactInfo {
  email: string;
  name?: string;
  /** Messages received from them. */
  received: number;
  /** Messages we sent to them. */
  sent: number;
  lastDate: string;
}

/**
 * Address book derived from the cache: senders of received mail plus
 * recipients (To and Cc) of our sent mail, ranked by recency. Own addresses
 * excluded.
 */
export function contactsList(selfEmails: string[], limit = 500): ContactInfo[] {
  const d = getDb();
  const map = new Map<string, ContactInfo>();
  const self = new Set(selfEmails.map((s) => s.toLowerCase()));

  const fromRows = d
    .prepare(
      `SELECT LOWER(from_email) AS email, MAX(from_name) AS name,
              COUNT(*) AS count, MAX(date) AS last
       FROM messages WHERE state != 'sent' GROUP BY LOWER(from_email)`,
    )
    .all() as { email: string; name: string | null; count: number; last: string }[];
  for (const r of fromRows) {
    if (!r.email || self.has(r.email)) continue;
    map.set(r.email, {
      email: r.email,
      name: r.name ?? undefined,
      received: Number(r.count),
      sent: 0,
      lastDate: r.last,
    });
  }

  // To AND Cc of our sent mail — people we only ever Cc'd were previously
  // invisible here (取りこぼし).
  for (const column of ["to_json", "cc_json"]) {
    const sentRows = d
      .prepare(
        `SELECT LOWER(json_extract(j.value, '$.email')) AS email,
                json_extract(j.value, '$.name') AS name,
                COUNT(*) AS count, MAX(m.date) AS last
         FROM messages m, json_each(m.${column}) j
         WHERE m.state = 'sent' GROUP BY LOWER(json_extract(j.value, '$.email'))`,
      )
      .all() as { email: string | null; name: string | null; count: number; last: string }[];
    for (const r of sentRows) {
      if (!r.email || self.has(r.email)) continue;
      const cur = map.get(r.email);
      if (cur) {
        cur.sent += Number(r.count);
        cur.name = cur.name ?? r.name ?? undefined;
        if (r.last > cur.lastDate) cur.lastDate = r.last;
      } else {
        map.set(r.email, {
          email: r.email,
          name: r.name ?? undefined,
          received: 0,
          sent: Number(r.count),
          lastDate: r.last,
        });
      }
    }
  }

  return [...map.values()]
    .sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1))
    .slice(0, limit);
}

/** Every cached message exchanged with a person, oldest first. */
export function contactTimeline(email: string, limit = 200): Email[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM messages
       WHERE LOWER(from_email) = LOWER(?)
          OR EXISTS (
            SELECT 1 FROM json_each(messages.to_json) j
            WHERE LOWER(json_extract(j.value, '$.email')) = LOWER(?)
          )
          OR EXISTS (
            SELECT 1 FROM json_each(messages.cc_json) j
            WHERE LOWER(json_extract(j.value, '$.email')) = LOWER(?)
          )
       ORDER BY date ASC LIMIT ?`,
    )
    .all(email, email, email, limit) as Record<string, unknown>[];
  return rows.map(rowToEmail);
}

export interface StorageStats {
  /** Actual size of the SQLite database files on disk (db + wal). */
  fileBytes: number;
  totalMessages: number;
  perAccount: { account: string; count: number; bytes: number }[];
}

/** Storage usage for the Gmail-style meter in the sidebar. */
export function storageStats(): StorageStats {
  getDb(); // ensure files exist
  let fileBytes = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fileBytes += statSync(DB_PATH + suffix).size;
    } catch {
      /* file may not exist yet */
    }
  }
  const rows = getDb()
    .prepare(
      `SELECT account, COUNT(*) AS count,
              SUM(LENGTH(body) + LENGTH(subject) + LENGTH(snippet)) AS bytes
       FROM messages GROUP BY account ORDER BY count DESC`,
    )
    .all() as { account: string; count: number; bytes: number | null }[];
  return {
    fileBytes,
    totalMessages: rows.reduce((n, r) => n + Number(r.count), 0),
    perAccount: rows.map((r) => ({
      account: r.account,
      count: Number(r.count),
      bytes: Number(r.bytes ?? 0),
    })),
  };
}
