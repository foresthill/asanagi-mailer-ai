import { DatabaseSync } from "node:sqlite";
import { statSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Email, EmailAddress, Importance, MailboxState } from "@/lib/types";

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
    CREATE TABLE IF NOT EXISTS judgments (
      account     TEXT NOT NULL,
      email_id    TEXT NOT NULL,
      subject     TEXT,
      from_name   TEXT,
      from_email  TEXT,
      importance  TEXT NOT NULL,
      reason      TEXT,
      source      TEXT,
      verdict     TEXT,
      created_at  TEXT,
      PRIMARY KEY (account, email_id)
    );
    CREATE TABLE IF NOT EXISTS ai_usage (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      kind          TEXT NOT NULL,
      model         TEXT,
      input_tokens  INTEGER,
      output_tokens INTEGER,
      created_at    TEXT
    );
  `);
  // Lightweight migration for pre-existing databases (node:sqlite has no
  // IF NOT EXISTS for columns — the duplicate-column error means "done").
  try {
    db.exec("ALTER TABLE messages ADD COLUMN starred INTEGER DEFAULT 0");
  } catch {
    /* column already exists */
  }
  try {
    db.exec("ALTER TABLE messages ADD COLUMN bcc_json TEXT");
  } catch {
    /* column already exists */
  }
  return db;
}

function rowToEmail(r: Record<string, unknown>): Email {
  return {
    id: String(r.id),
    threadId: String(r.thread_id ?? r.id),
    from: { name: (r.from_name as string) || undefined, email: String(r.from_email ?? "") },
    to: JSON.parse(String(r.to_json ?? "[]")) as EmailAddress[],
    cc: JSON.parse(String(r.cc_json ?? "[]")) as EmailAddress[],
    bcc: JSON.parse(String(r.bcc_json ?? "[]")) as EmailAddress[],
    subject: String(r.subject ?? ""),
    snippet: String(r.snippet ?? ""),
    body: String(r.body ?? ""),
    date: String(r.date ?? ""),
    read: Boolean(r.read),
    starred: Boolean(r.starred),
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
      (account, id, thread_id, from_name, from_email, to_json, cc_json, bcc_json,
       subject, snippet, body, date, read, starred, state, message_id, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(e.bcc ?? []),
        e.subject,
        e.snippet,
        e.body,
        e.date,
        e.read ? 1 : 0,
        e.starred ? 1 : 0,
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
  patch: { state?: MailboxState; read?: boolean; starred?: boolean },
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
  if (patch.starred !== undefined) {
    getDb()
      .prepare("UPDATE messages SET starred = ? WHERE account = ? AND id = ?")
      .run(patch.starred ? 1 : 0, account, id);
  }
}

/**
 * Starred mail across folders (trash excluded), newest first. Served from
 * the cache: star state refreshes with every live list fetch, so coverage is
 * the cached window (recent mail), not the provider's full history.
 */
export function cachedStarred(accounts: string[], limit = 100): Email[] {
  if (!accounts.length) return [];
  const marks = accounts.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT * FROM messages
       WHERE account IN (${marks}) AND starred = 1 AND state != 'trashed'
       ORDER BY date DESC LIMIT ?`,
    )
    .all(...accounts, limit) as Record<string, unknown>[];
  return rows.map(rowToEmail);
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
  /** One of the user's own addresses (セルフメール＝メモ運用も多いため表示する). */
  self?: boolean;
}

/**
 * Address book derived from the cache: senders of received mail plus
 * recipients (To and Cc) of our sent mail, ranked by recency. Own addresses
 * are included (flagged `self`) — self-mail is a common memo workflow, so
 * the timeline must be reachable. Counts for self = self-addressed mail only.
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
    if (!r.email) continue;
    map.set(r.email, {
      email: r.email,
      name: r.name ?? undefined,
      received: Number(r.count),
      sent: 0,
      lastDate: r.last,
      self: self.has(r.email) || undefined,
    });
  }

  // To AND Cc of our sent mail — people we only ever Cc'd were previously
  // invisible here (取りこぼし).
  for (const column of ["to_json", "cc_json", "bcc_json"]) {
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
      if (!r.email) continue;
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
          self: self.has(r.email) || undefined,
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

// ---------------------------------------------------------------------------
// Judgment log — every AI/heuristic importance call, plus the user's verdict.
// This is the supervised-learning seed (docs/02): corrections feed the live
// signal store immediately and accumulate as a training set for the future
// local classifier.
// ---------------------------------------------------------------------------

export interface Judgment {
  account: string;
  emailId: string;
  subject: string;
  fromName?: string;
  fromEmail: string;
  importance: Importance;
  reason?: string;
  /** What produced the judgment: ai | heuristic | learned. */
  source: string;
  /** The user's correction/confirmation; null = not reviewed yet. */
  verdict: Importance | null;
  createdAt: string;
}


/** Record (or refresh) the latest judgment for an email. */
export function logJudgment(j: Omit<Judgment, "verdict" | "createdAt">): void {
  getDb()
    .prepare(
      `INSERT INTO judgments
         (account, email_id, subject, from_name, from_email, importance, reason, source, verdict, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(account, email_id) DO UPDATE SET
         importance = excluded.importance,
         reason = excluded.reason,
         source = excluded.source,
         created_at = excluded.created_at`,
    )
    .run(
      j.account,
      j.emailId,
      j.subject,
      j.fromName ?? null,
      j.fromEmail,
      j.importance,
      j.reason ?? null,
      j.source,
      new Date().toISOString(),
    );
}

export function listJudgments(limit = 100): Judgment[] {
  const rows = getDb()
    .prepare("SELECT * FROM judgments ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    account: String(r.account),
    emailId: String(r.email_id),
    subject: String(r.subject ?? ""),
    fromName: (r.from_name as string) || undefined,
    fromEmail: String(r.from_email ?? ""),
    importance: String(r.importance) as Importance,
    reason: (r.reason as string) || undefined,
    source: String(r.source ?? ""),
    verdict: (r.verdict as Importance | null) ?? null,
    createdAt: String(r.created_at ?? ""),
  }));
}

export function setJudgmentVerdict(
  account: string,
  emailId: string,
  verdict: Importance,
): void {
  getDb()
    .prepare("UPDATE judgments SET verdict = ? WHERE account = ? AND email_id = ?")
    .run(verdict, account, emailId);
}

/** Accuracy snapshot: how often the user agreed with the judgment. */
export function judgmentStats(): { total: number; reviewed: number; agreed: number } {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN verdict IS NOT NULL THEN 1 ELSE 0 END) AS reviewed,
              SUM(CASE WHEN verdict = importance THEN 1 ELSE 0 END) AS agreed
       FROM judgments`,
    )
    .get() as { total: number; reviewed: number | null; agreed: number | null };
  return {
    total: Number(row.total),
    reviewed: Number(row.reviewed ?? 0),
    agreed: Number(row.agreed ?? 0),
  };
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

// ---------------------------------------------------------------------------
// AI usage log — input/output tokens per call, all local (cost transparency)
// ---------------------------------------------------------------------------

export interface AiUsageStats {
  /** All-time totals. */
  total: { calls: number; inputTokens: number; outputTokens: number };
  /** Last 30 days. */
  recent: { calls: number; inputTokens: number; outputTokens: number };
  /** Breakdown by model (all-time), heaviest first. */
  byModel: { model: string; calls: number; inputTokens: number; outputTokens: number }[];
  /** Breakdown by feature (all-time): reply / suggest / classify. */
  byKind: { kind: string; calls: number; inputTokens: number; outputTokens: number }[];
  /** Per feature × model (all-time) — lets the USD estimate be split by kind. */
  byKindModel: {
    kind: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  }[];
}

/** Record one AI call. Never throws — logging must not break the feature. */
export function logAiUsage(
  kind: string,
  model: string,
  inputTokens?: number,
  outputTokens?: number,
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO ai_usage (kind, model, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(kind, model, inputTokens ?? null, outputTokens ?? null, new Date().toISOString());
  } catch {
    /* best-effort */
  }
}

export function aiUsageStats(): AiUsageStats {
  const d = getDb();
  const sums = (where: string, params: string[] = []) =>
    d
      .prepare(
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(input_tokens), 0) AS input,
                COALESCE(SUM(output_tokens), 0) AS output
         FROM ai_usage ${where}`,
      )
      .get(...params) as { calls: number; input: number; output: number };

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const total = sums("");
  const recent = sums("WHERE created_at >= ?", [since]);

  const group = (col: "model" | "kind") =>
    (
      d
        .prepare(
          `SELECT ${col} AS k, COUNT(*) AS calls,
                  COALESCE(SUM(input_tokens), 0) AS input,
                  COALESCE(SUM(output_tokens), 0) AS output
           FROM ai_usage GROUP BY ${col} ORDER BY input + output DESC`,
        )
        .all() as { k: string | null; calls: number; input: number; output: number }[]
    ).map((r) => ({
      calls: Number(r.calls),
      inputTokens: Number(r.input),
      outputTokens: Number(r.output),
      ...(col === "model" ? { model: r.k ?? "(不明)" } : { kind: r.k ?? "(不明)" }),
    }));

  const byKindModel = (
    d
      .prepare(
        `SELECT kind, model, COUNT(*) AS calls,
                COALESCE(SUM(input_tokens), 0) AS input,
                COALESCE(SUM(output_tokens), 0) AS output
         FROM ai_usage GROUP BY kind, model ORDER BY input + output DESC`,
      )
      .all() as { kind: string | null; model: string | null; calls: number; input: number; output: number }[]
  ).map((r) => ({
    kind: r.kind ?? "(不明)",
    model: r.model ?? "(不明)",
    calls: Number(r.calls),
    inputTokens: Number(r.input),
    outputTokens: Number(r.output),
  }));

  return {
    total: { calls: Number(total.calls), inputTokens: Number(total.input), outputTokens: Number(total.output) },
    recent: { calls: Number(recent.calls), inputTokens: Number(recent.input), outputTokens: Number(recent.output) },
    byModel: group("model") as AiUsageStats["byModel"],
    byKind: group("kind") as AiUsageStats["byKind"],
    byKindModel,
  };
}
