#!/usr/bin/env node
/**
 * Asanagi MCP server (read-only, local-first).
 *
 * Exposes the local mail cache (.data/asanagi.db) + the project hub
 * (.data/projects.json) as MCP tools, so an AI client (Claude Desktop /
 * Claude Code) can answer "did this mail arrive?", "what happened with X?",
 * and "what's the project progress?" — all from on-device data.
 *
 * READ-ONLY by design: no send / archive / delete here (those stay in the app,
 * behind explicit user action). Run: `npm run mcp`. Setup: see mcp/README.md.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const DATA_DIR = process.env.ASANAGI_DATA_DIR || path.join(import.meta.dirname, "..", ".data");
const DB_PATH = path.join(DATA_DIR, "asanagi.db");
const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");

let _db;
function db() {
  if (!_db) {
    if (!existsSync(DB_PATH)) throw new Error(`Asanagi cache not found: ${DB_PATH}. 先にアプリを一度起動してメールを同期してください。`);
    _db = new DatabaseSync(DB_PATH, { readOnly: true });
  }
  return _db;
}

const FIELDS = ["subject", "body", "from_name", "from_email", "to_json", "cc_json"];
const STOP = new Set(["the","a","an","of","to","in","on","at","by","for","and","or","is","are","be","with","from","this","that","it","as","was","were","will","your","you","please","we","our"]);
const esc = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const orClause = FIELDS.map((f) => `${f} LIKE ? ESCAPE '\\'`).join(" OR ");

/** Compact view of a cached message (no full body — that's get_email). */
function lite(r) {
  return {
    id: `${r.account}/${r.id}`,
    account: r.account,
    from: r.from_name || r.from_email,
    fromEmail: r.from_email,
    subject: r.subject,
    date: r.date,
    state: r.state,
    snippet: (r.snippet || "").slice(0, 200),
    hasAttachment: !!r.has_attachment,
  };
}

/** Phrase-first, then stopword-filtered AND fallback (mirrors the app). */
function searchMail(query, limit = 20) {
  const q = (query || "").trim();
  if (!q) return [];
  const phraseLike = `%${esc(q)}%`;
  const phrase = db()
    .prepare(`SELECT * FROM messages WHERE (${orClause}) ORDER BY date DESC LIMIT ?`)
    .all(...FIELDS.map(() => phraseLike), limit);
  if (phrase.length) return phrase.map(lite);
  const terms = q.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2 && !STOP.has(t.toLowerCase())).slice(0, 6);
  if (!terms.length) return [];
  const clause = terms.map(() => `(${orClause})`).join(" AND ");
  const params = terms.flatMap((t) => { const l = `%${esc(t)}%`; return FIELDS.map(() => l); });
  return db().prepare(`SELECT * FROM messages WHERE ${clause} ORDER BY date DESC LIMIT ?`).all(...params, limit).map(lite);
}

function splitId(id) {
  const i = id.indexOf("/");
  return i > 0 ? { account: id.slice(0, i), raw: id.slice(i + 1) } : { account: null, raw: id };
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "asanagi", version: "0.1.0" });

server.registerTool(
  "search_mail",
  {
    description: "ローカルにキャッシュされたメールを検索する（件名・本文・差出人・宛先）。「〇〇のメール来てた？」に。",
    inputSchema: { query: z.string().describe("検索語（フレーズ可）"), limit: z.number().int().min(1).max(50).optional() },
  },
  async ({ query, limit }) => ok(searchMail(query, limit ?? 20)),
);

server.registerTool(
  "list_recent",
  {
    description: "フォルダの最近のメールを新しい順で一覧する。",
    inputSchema: {
      folder: z.enum(["inbox", "sent", "archived", "trashed"]).optional(),
      account: z.string().optional().describe("gmail / imap 等。未指定は全アカウント"),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ folder, account, limit }) => {
    const where = ["state = ?"];
    const params = [folder ?? "inbox"];
    if (account) { where.push("account = ?"); params.push(account); }
    const rows = db().prepare(`SELECT * FROM messages WHERE ${where.join(" AND ")} ORDER BY date DESC LIMIT ?`).all(...params, limit ?? 20);
    return ok(rows.map(lite));
  },
);

server.registerTool(
  "get_thread",
  {
    description: "会話（スレッド）を時系列で取得する。「あの件どうなってた？」に。id はメールid(account/xxx)でもスレッドidでも可。",
    inputSchema: { id: z.string().describe("email id (account/xxx) か thread id") },
  },
  async ({ id }) => {
    const { account, raw } = splitId(id);
    let threadId = raw, acct = account;
    // If it's an email id, resolve its thread_id first.
    if (acct) {
      const row = db().prepare("SELECT thread_id FROM messages WHERE account = ? AND id = ?").get(acct, raw);
      if (row?.thread_id) threadId = row.thread_id;
    } else {
      const row = db().prepare("SELECT account, thread_id FROM messages WHERE id = ? OR thread_id = ? LIMIT 1").get(raw, raw);
      if (row) { acct = row.account; threadId = row.thread_id ?? raw; }
    }
    const marks = acct ? "account = ? AND thread_id = ?" : "thread_id = ?";
    const params = acct ? [acct, threadId] : [threadId];
    const rows = db().prepare(`SELECT * FROM messages WHERE ${marks} ORDER BY date ASC LIMIT 100`).all(...params);
    return ok(rows.map((r) => ({ ...lite(r), body: (r.body || "").slice(0, 4000) })));
  },
);

server.registerTool(
  "check_received",
  {
    description: "特定の差出人・件名のメールが届いているか確認する（件数＋最新）。「東洋テックからNDA来てた？」に。",
    inputSchema: {
      from: z.string().optional().describe("差出人名・アドレスの一部"),
      subject: z.string().optional().describe("件名の一部"),
      sinceDays: z.number().int().min(1).optional().describe("過去何日以内か"),
    },
  },
  async ({ from, subject, sinceDays }) => {
    const where = [];
    const params = [];
    if (from) { where.push("(from_name LIKE ? ESCAPE '\\' OR from_email LIKE ? ESCAPE '\\')"); const l = `%${esc(from)}%`; params.push(l, l); }
    if (subject) { where.push("subject LIKE ? ESCAPE '\\'"); params.push(`%${esc(subject)}%`); }
    if (sinceDays) { where.push("date >= ?"); params.push(new Date(Date.now() - sinceDays * 864e5).toISOString()); }
    if (!where.length) return ok({ error: "from か subject のどちらかを指定してください" });
    const rows = db().prepare(`SELECT * FROM messages WHERE ${where.join(" AND ")} ORDER BY date DESC LIMIT 10`).all(...params);
    return ok({ received: rows.length > 0, count: rows.length, latest: rows.slice(0, 5).map(lite) });
  },
);

server.registerTool(
  "get_email",
  {
    description: "1通のメールの全文（本文）を取得する。",
    inputSchema: { id: z.string().describe("email id (account/xxx)") },
  },
  async ({ id }) => {
    const { account, raw } = splitId(id);
    const row = account
      ? db().prepare("SELECT * FROM messages WHERE account = ? AND id = ?").get(account, raw)
      : db().prepare("SELECT * FROM messages WHERE id = ? LIMIT 1").get(raw);
    if (!row) return ok({ error: "見つかりませんでした（キャッシュ内に無い可能性）" });
    return ok({ ...lite(row), to: row.to_json, cc: row.cc_json, body: row.body || "" });
  },
);

server.registerTool(
  "list_projects",
  {
    description: "メール履歴から抽出したプロジェクトの進捗・次アクション一覧（プロジェクト・ハブ）。",
    inputSchema: {},
  },
  async () => {
    if (!existsSync(PROJECTS_PATH)) return ok({ projects: [], note: "まだ生成されていません。アプリの『プロジェクト』→『メール履歴から更新』で生成してください。" });
    try {
      return ok(JSON.parse(await readFile(PROJECTS_PATH, "utf8")));
    } catch {
      return ok({ projects: [], error: "projects.json を読めませんでした" });
    }
  },
);

await server.connect(new StdioServerTransport());
