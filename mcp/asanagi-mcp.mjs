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
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const CONFIGURED = process.env.ASANAGI_DATA_DIR || path.join(import.meta.dirname, "..", ".data");

/** Find the folder that actually holds asanagi.db. Accepts either the `.data`
 *  folder itself OR a parent (e.g. the project root) that contains `.data` —
 *  so users can pick the VISIBLE project folder in Claude Desktop's picker
 *  instead of the hidden `.data` folder. */
function dataDir() {
  for (const d of [CONFIGURED, path.join(CONFIGURED, ".data")]) {
    if (existsSync(path.join(d, "asanagi.db"))) return d;
  }
  return CONFIGURED;
}
const dbPath = () => path.join(dataDir(), "asanagi.db");
const projectsPath = () => path.join(dataDir(), "projects.json");

let _db;
function db() {
  if (!_db) {
    const p = dbPath();
    if (!existsSync(p)) {
      throw new Error(
        `asanagi.db が見つかりません（探した場所: ${CONFIGURED} と ${path.join(CONFIGURED, ".data")}）。` +
          `Asanagi のプロジェクトフォルダ（.data がある場所）を指定し、先にアプリを起動してメールを同期してください。`,
      );
    }
    _db = new DatabaseSync(p, { readOnly: true });
    // Fail fast (5s) instead of hanging if the app holds a lock mid-write.
    try {
      _db.exec("PRAGMA busy_timeout = 5000");
    } catch {
      /* pragma is best-effort */
    }
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

/** "Name <a@b>" or "a@b" -> { name?, email }. */
function parseAddr(s) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(s);
  if (m) return { name: m[1] || undefined, email: m[2].trim() };
  return { email: String(s).trim() };
}

const server = new McpServer({ name: "asanagi", version: "0.1.2" });

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
    // "返したか" — did I already reply in this thread? True if a sent message
    // exists AND it's newer than the newest received one (a stale sent that
    // predates a later inbound doesn't count as "replied to that inbound").
    const sent = rows.filter((r) => r.state === "sent");
    const inbound = rows.filter((r) => r.state !== "sent");
    const lastSent = sent.at(-1)?.date ?? "";
    const lastInbound = inbound.at(-1)?.date ?? "";
    const replied = sent.length > 0 && lastSent >= lastInbound;
    return ok({
      replied,
      awaitingReply: inbound.length > 0 && lastInbound > lastSent,
      count: rows.length,
      messages: rows.map((r) => ({ ...lite(r), body: (r.body || "").slice(0, 4000) })),
    });
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
    const pp = projectsPath();
    if (!existsSync(pp)) return ok({ projects: [], note: "まだ生成されていません。アプリの『プロジェクト』→『メール履歴から更新』で生成してください。" });
    try {
      return ok(JSON.parse(await readFile(pp, "utf8")));
    } catch {
      return ok({ projects: [], error: "projects.json を読めませんでした" });
    }
  },
);

// The ONLY write tool. Draft-only by design — it never sends. Drafts land in
// .data/drafts.json (the same local store the app's composer reads), so you
// open, review, edit and send them by hand in Asanagi. No provider call here.
server.registerTool(
  "create_draft",
  {
    description:
      "返信・新規メールの下書きを作成する（送信はしない・端末内の下書きに保存のみ）。" +
      "reply_to_id を渡すと、その相手・件名(Re:)・スレッドを引き継いで返信下書きにする。" +
      "作成後は Asanagi アプリの下書きから内容を確認・編集して手動で送信する。",
    inputSchema: {
      body: z.string().describe("本文（プレーンテキスト）"),
      reply_to_id: z.string().optional().describe("返信元の email id (account/xxx)。相手・件名・スレッドを引き継ぐ"),
      to: z.array(z.string()).optional().describe("宛先。'Name <a@b>' か 'a@b'。reply_to_id 指定時は省略可"),
      cc: z.array(z.string()).optional().describe("Cc。'Name <a@b>' か 'a@b'"),
      subject: z.string().optional().describe("件名。reply_to_id 指定時は省略で自動 Re:"),
      account: z.string().optional().describe("送信元アカウント。省略時は返信元 or 既定"),
    },
  },
  async ({ body, reply_to_id, to, cc, subject, account }) => {
    let toAddrs = (to ?? []).map(parseAddr);
    let subj = subject ?? "";
    let account_ = account;
    let threadId;
    let inReplyTo;

    if (reply_to_id) {
      const { account: a, raw } = splitId(reply_to_id);
      const src = a
        ? db().prepare("SELECT * FROM messages WHERE account = ? AND id = ?").get(a, raw)
        : db().prepare("SELECT * FROM messages WHERE id = ? LIMIT 1").get(raw);
      if (!src) return ok({ error: "返信元が見つかりませんでした（キャッシュ内に無い可能性）" });
      // Reply to the sender of the source message.
      if (!toAddrs.length && src.from_email) {
        toAddrs = [{ name: src.from_name || undefined, email: src.from_email }];
      }
      if (!subj) {
        const base = String(src.subject ?? "").replace(/^\s*(re:\s*)+/i, "").trim();
        subj = `Re: ${base}`;
      }
      account_ = account_ ?? src.account;
      threadId = src.thread_id || src.id;
      inReplyTo = src.message_id || undefined;
    }

    if (!toAddrs.length) {
      return ok({ error: "宛先(to)が空です。reply_to_id か to を指定してください。" });
    }

    const draft = {
      id: randomUUID(),
      to: toAddrs,
      ...(cc && cc.length ? { cc: cc.map(parseAddr) } : {}),
      subject: subj,
      body,
      ...(threadId ? { threadId } : {}),
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(account_ ? { account: account_ } : {}),
      updatedAt: new Date().toISOString(),
    };

    // Upsert into drafts.json (same shape the app's saveDraft writes).
    const dp = path.join(dataDir(), "drafts.json");
    let all = [];
    try {
      all = JSON.parse(await readFile(dp, "utf8"));
      if (!Array.isArray(all)) all = [];
    } catch {
      /* no file yet → start fresh */
    }
    all.push(draft);
    await writeFile(dp, JSON.stringify(all, null, 2), "utf8");

    return ok({
      created: true,
      note: "下書きに保存しました（未送信）。Asanagi アプリの下書きから確認・編集して送信してください。",
      draft: {
        id: draft.id,
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        account: draft.account,
        isReply: !!reply_to_id,
      },
    });
  },
);

await server.connect(new StdioServerTransport());
