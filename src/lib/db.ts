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
