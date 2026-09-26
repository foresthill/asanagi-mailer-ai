import { promises as fs } from "node:fs";
import path from "node:path";
import { isTracked, snapshotLearning } from "./learning-history";
import type {
  AIProvider,
  AISettings,
  EmailSettings,
  ImportanceSignal,
  Importance,
  ProjectHub,
  ScheduledSend,
  SavedDraft,
  ContactMeta,
  ResolvedContactMeta,
  TodoItem,
} from "@/lib/types";
import type { ThreatSenders } from "./threat";

/**
 * Tiny file-backed JSON store. Good enough for local MVP persistence
 * (mailbox state, scheduled sends, learned importance signals).
 * Swap for a real DB (e.g. a Marketplace Postgres) in a later phase.
 */
// Desktop (Tauri) builds set ASANAGI_DATA_DIR to the OS app-data dir; dev/web
// fall back to ./.data (current behavior unchanged).
const DATA_DIR =
  process.env.ASANAGI_DATA_DIR || path.join(process.cwd(), ".data");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(file: string, data: T): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    path.join(DATA_DIR, file),
    JSON.stringify(data, null, 2),
    "utf8",
  );
  // Learned state (signals / メモ / 署名 / notes) → local-only git history
  // (best-effort, debounced; secrets & the DB are never tracked). See
  // learning-history.ts. Non-learning files (secrets etc.) are skipped.
  if (isTracked(file)) snapshotLearning();
}

// Exposed so the mock provider can persist mailbox mutations.
export const store = { readJson, writeJson };

// ---------------------------------------------------------------------------
// AI connection settings (BYOK) — stored locally, never leaves the device
// ---------------------------------------------------------------------------
const AI_SETTINGS = "ai-settings.json";

export async function getAISettings(): Promise<AISettings> {
  return readJson<AISettings>(AI_SETTINGS, {});
}

/**
 * Merge a patch into stored AI settings. Keys merge per-provider; passing an
 * empty/blank string for a provider clears that key.
 */
export async function saveAISettings(patch: AISettings): Promise<AISettings> {
  const cur = await getAISettings();
  const next: AISettings = {
    ...cur,
    ...patch,
    keys: { ...(cur.keys ?? {}), ...(patch.keys ?? {}) },
  };
  if (next.keys) {
    for (const k of Object.keys(next.keys) as AIProvider[]) {
      if (!next.keys[k]?.trim()) delete next.keys[k];
    }
    if (Object.keys(next.keys).length === 0) delete next.keys;
  }
  await writeJson(AI_SETTINGS, next);
  return next;
}

// ---------------------------------------------------------------------------
// Email connection settings — stored locally, never leaves the device
// ---------------------------------------------------------------------------
const EMAIL_SETTINGS = "email-settings.json";

export async function getEmailSettings(): Promise<EmailSettings> {
  return readJson<EmailSettings>(EMAIL_SETTINGS, {});
}

/**
 * Merge a patch into stored email settings. Within `gmail` / `imap`, blank
 * strings clear that field (e.g. disconnect = { gmail: { refreshToken: "" } }).
 */
export async function saveEmailSettings(
  patch: EmailSettings,
): Promise<EmailSettings> {
  const cur = await getEmailSettings();
  const next: EmailSettings = { ...cur };
  if (patch.active) next.active = patch.active;
  if (patch.inboxCutoff !== undefined) {
    // Blank clears the horizon (= no limit).
    if (patch.inboxCutoff.trim()) next.inboxCutoff = patch.inboxCutoff.trim();
    else delete next.inboxCutoff;
  }

  for (const section of ["gmail", "imap"] as const) {
    if (!patch[section]) continue;
    const merged: Record<string, string | undefined> = {
      ...(cur[section] ?? {}),
      ...(patch[section] ?? {}),
    };
    for (const k of Object.keys(merged)) {
      if (!merged[k]?.trim()) delete merged[k];
    }
    if (Object.keys(merged).length > 0) {
      next[section] = merged;
    } else {
      delete next[section];
    }
  }

  await writeJson(EMAIL_SETTINGS, next);
  return next;
}

// ---------------------------------------------------------------------------
// Scheduled sends
// ---------------------------------------------------------------------------
const SCHEDULED = "scheduled.json";

export async function listScheduled(): Promise<ScheduledSend[]> {
  return readJson<ScheduledSend[]>(SCHEDULED, []);
}

export async function addScheduled(item: ScheduledSend): Promise<void> {
  const all = await listScheduled();
  all.push(item);
  await writeJson(SCHEDULED, all);
}

export async function updateScheduled(
  id: string,
  patch: Partial<ScheduledSend>,
): Promise<ScheduledSend | undefined> {
  const all = await listScheduled();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return undefined;
  all[idx] = { ...all[idx], ...patch };
  await writeJson(SCHEDULED, all);
  return all[idx];
}

/** Return scheduled sends whose time has arrived and are still pending. */
export async function dueScheduled(now = new Date()): Promise<ScheduledSend[]> {
  const all = await listScheduled();
  return all.filter(
    (s) => s.status === "scheduled" && new Date(s.sendAt) <= now,
  );
}

// ---------------------------------------------------------------------------
// Saved drafts (local-first — never pushed to the provider Drafts folder)
// ---------------------------------------------------------------------------
const DRAFTS = "drafts.json";

export async function listDrafts(): Promise<SavedDraft[]> {
  return readJson<SavedDraft[]>(DRAFTS, []);
}

/** Upsert a draft by id (newest content wins). */
export async function saveDraft(draft: SavedDraft): Promise<SavedDraft> {
  const all = await listDrafts();
  const idx = all.findIndex((d) => d.id === draft.id);
  if (idx === -1) all.push(draft);
  else all[idx] = draft;
  await writeJson(DRAFTS, all);
  return draft;
}

export async function deleteDraft(id: string): Promise<void> {
  const all = await listDrafts();
  await writeJson(
    DRAFTS,
    all.filter((d) => d.id !== id),
  );
}

// ---------------------------------------------------------------------------
// 自分用メモ — メール1通ごとの私的メモ。端末内のみ・AIには一切渡さない。
// ---------------------------------------------------------------------------
const NOTES = "notes.json";
type NoteMap = Record<string, { text: string; updatedAt: string }>;

export async function getNote(id: string): Promise<string> {
  const all = await readJson<NoteMap>(NOTES, {});
  return all[id]?.text ?? "";
}

/** Set (or clear, when blank) the private note for one email id. */
export async function setNote(id: string, text: string): Promise<void> {
  const all = await readJson<NoteMap>(NOTES, {});
  if (text.trim())
    all[id] = {
      text: text.slice(0, 4000),
      updatedAt: new Date().toISOString(),
    };
  else delete all[id];
  await writeJson(NOTES, all);
}

/** Ids of emails that have a note — for the list indicator. */
export async function listNoteIds(): Promise<string[]> {
  return Object.keys(await readJson<NoteMap>(NOTES, {}));
}

// ---------------------------------------------------------------------------
// 嗜好プロファイル（AIへのメモ） — 自然文の判定ルール。判定プロンプトに注入。
// docs/02 §5.4 / §6.2。ユーザーが直接編集できる learned instructions。
// ---------------------------------------------------------------------------
const JUDGMENT_PROFILE = "judgment-profile.json";

export async function getJudgmentProfile(): Promise<string> {
  const d = await readJson<{ text: string }>(JUDGMENT_PROFILE, { text: "" });
  return d.text ?? "";
}

export async function saveJudgmentProfile(text: string): Promise<void> {
  await writeJson(JUDGMENT_PROFILE, { text: text.slice(0, 4000) });
}

// ---------------------------------------------------------------------------
// 文章作成メモ（返信・添削のルール） — 判定用とは別枠。返信下書き(reply)と
// 添削(suggest)のプロンプトに注入する、ユーザー自筆の文体ルール。
// 例:「絵文字は使わない」「過剰敬語にしない」「勝手に日程を確約しない」。
// AIが変な修正をしたら1行足すだけで恒久的に反映される（in-context 学習）。
// ---------------------------------------------------------------------------
const WRITING_NOTE = "writing-note.json";

export async function getWritingNote(): Promise<string> {
  const d = await readJson<{ text: string }>(WRITING_NOTE, { text: "" });
  return d.text ?? "";
}

export async function saveWritingNote(text: string): Promise<void> {
  await writeJson(WRITING_NOTE, { text: text.slice(0, 4000) });
}

// ---------------------------------------------------------------------------
// プロジェクト・ハブ — AI抽出した案件一覧（pull型）。実データはローカルのみ。
// ---------------------------------------------------------------------------
const PROJECTS = "projects.json";

export async function getProjectHub(): Promise<ProjectHub> {
  return readJson<ProjectHub>(PROJECTS, { projects: [] });
}

export async function saveProjectHub(hub: ProjectHub): Promise<void> {
  await writeJson(PROJECTS, hub);
}

// ---------------------------------------------------------------------------
// AI返信での「自分の名乗り／署名」。アカウント別（gmail / imap 等）に、返信を
// 誰として書くかをAIに伝える。スレッド履歴の送信者名が別人でも、返信者は
// 「そのアカウントの本人」であることを明示するために使う。
// ---------------------------------------------------------------------------
const REPLY_SIGNATURES = "reply-signatures.json";

export async function getReplySignatures(): Promise<Record<string, string>> {
  return readJson<Record<string, string>>(REPLY_SIGNATURES, {});
}

export async function getReplySignature(account?: string): Promise<string> {
  if (!account) return "";
  const all = await getReplySignatures();
  return all[account] ?? "";
}

export async function saveReplySignature(
  account: string,
  text: string,
): Promise<void> {
  const all = await getReplySignatures();
  const trimmed = text.slice(0, 2000);
  if (trimmed.trim()) all[account] = trimmed;
  else delete all[account]; // 空 = そのアカウントの設定を消す
  await writeJson(REPLY_SIGNATURES, all);
}

// ---------------------------------------------------------------------------
// Learned importance signals (seed of the per-user knowledge base)
// ---------------------------------------------------------------------------
const SIGNALS = "signals.json";

export async function listSignals(): Promise<ImportanceSignal[]> {
  return readJson<ImportanceSignal[]>(SIGNALS, []);
}

/**
 * Record user feedback about an email's importance. Reinforces a sender
 * signal (and a domain signal) so future classification learns the user's
 * preferences over time.
 */
export async function recordImportanceFeedback(
  fromEmail: string,
  importance: Importance,
  projectKey?: string,
  now = new Date(),
): Promise<void> {
  const signals = await listSignals();
  const domain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "";

  const upsert = (pattern: string, kind: ImportanceSignal["kind"]) => {
    if (!pattern) return;
    const existing = signals.find(
      (s) => s.kind === kind && s.pattern === pattern,
    );
    if (existing) {
      // If the user flips their judgment, move toward the new label and reset weight.
      if (existing.importance === importance) {
        existing.weight += 1;
      } else {
        existing.importance = importance;
        existing.weight = 1;
      }
      existing.updatedAt = now.toISOString();
    } else {
      signals.push({
        id: `${kind}:${pattern}:${now.getTime()}`,
        pattern,
        kind,
        importance,
        weight: 1,
        updatedAt: now.toISOString(),
      });
    }
  };

  // For a project-scoped mail (GitHub repo notification etc.), learn ONLY the
  // project — the shared sender (notifications@github.com) is not a meaningful
  // importance unit, and learning it would wrongly bias every other repo. For
  // normal mail, learn the sender + domain as before.
  if (projectKey) {
    upsert(projectKey, "project");
  } else {
    upsert(fromEmail, "sender");
    upsert(domain, "domain");
  }
  await writeJson(SIGNALS, signals);
}

// ---------------------------------------------------------------------------
// 迷惑メール報告の学習 — ユーザーが「迷惑メール/フィッシング」と報告した差出人/
// ドメインを憶えて、以降そのメールを危険として自動フラグ（detectThreat が参照）。
// ---------------------------------------------------------------------------
const THREAT_SENDERS = "threat-senders.json";

interface ThreatSenderEntry {
  pattern: string;
  kind: "sender" | "domain";
  weight: number;
  updatedAt: string;
}

export async function listThreatSenders(): Promise<ThreatSenders> {
  const rows = await readJson<ThreatSenderEntry[]>(THREAT_SENDERS, []);
  return {
    senders: new Set(
      rows.filter((r) => r.kind === "sender").map((r) => r.pattern),
    ),
    domains: new Set(
      rows.filter((r) => r.kind === "domain").map((r) => r.pattern),
    ),
  };
}

/** Remember "this sender is spam/phishing" (sender + domain). */
export async function recordThreatReport(
  fromEmail: string,
  now = new Date(),
): Promise<void> {
  const rows = await readJson<ThreatSenderEntry[]>(THREAT_SENDERS, []);
  const domain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "";
  const upsert = (pattern: string, kind: ThreatSenderEntry["kind"]) => {
    if (!pattern) return;
    const ex = rows.find((r) => r.kind === kind && r.pattern === pattern);
    if (ex) {
      ex.weight += 1;
      ex.updatedAt = now.toISOString();
    } else {
      rows.push({ pattern, kind, weight: 1, updatedAt: now.toISOString() });
    }
  };
  upsert(fromEmail, "sender");
  upsert(domain, "domain");
  await writeJson(THREAT_SENDERS, rows);
}

// 安全な差出人（誤検知の打ち消し）。「問題無し」で登録し、以降 detectThreat が
// この送信者/ドメインを危険と判定しない（ブランド偽装ヒューリスティックも上書き）。
const SAFE_SENDERS = "safe-senders.json";

export async function listSafeSenders(): Promise<ThreatSenders> {
  const rows = await readJson<ThreatSenderEntry[]>(SAFE_SENDERS, []);
  return {
    senders: new Set(
      rows.filter((r) => r.kind === "sender").map((r) => r.pattern),
    ),
    domains: new Set(
      rows.filter((r) => r.kind === "domain").map((r) => r.pattern),
    ),
  };
}

/**
 * 「問題無し」: この差出人を安全として学習（sender + domain）。同時に、誤って
 * 迷惑報告済みなら threat-senders から取り除く（フラグを確実に消す）。
 */
export async function recordSafeSender(
  fromEmail: string,
  now = new Date(),
): Promise<void> {
  const addr = fromEmail.toLowerCase();
  const domain = addr.includes("@") ? addr.split("@")[1] : "";
  const rows = await readJson<ThreatSenderEntry[]>(SAFE_SENDERS, []);
  const upsert = (pattern: string, kind: ThreatSenderEntry["kind"]) => {
    if (!pattern) return;
    const ex = rows.find((r) => r.kind === kind && r.pattern === pattern);
    if (ex) {
      ex.weight += 1;
      ex.updatedAt = now.toISOString();
    } else {
      rows.push({ pattern, kind, weight: 1, updatedAt: now.toISOString() });
    }
  };
  upsert(addr, "sender");
  upsert(domain, "domain");
  await writeJson(SAFE_SENDERS, rows);

  // Un-flag: drop this sender/domain from any prior spam report.
  const threat = await readJson<ThreatSenderEntry[]>(THREAT_SENDERS, []);
  const kept = threat.filter(
    (r) =>
      r.pattern !== addr && r.pattern !== fromEmail && r.pattern !== domain,
  );
  if (kept.length !== threat.length) await writeJson(THREAT_SENDERS, kept);
}

// ---------------------------------------------------------------------------
// 朝の一凪の「処分アクション」学習 — importance(low) だけでは archive と trash を
// 区別できず、毎回「アーカイブ→ゴミ箱」を押し直す羽目になる。送信者/ドメイン
// ごとに“実際に選んだ処分”を憶えて次回の既定にする。
// ---------------------------------------------------------------------------
const SWEEP_ACTIONS = "sweep-actions.json";

export type SweepLearnAction = "archive" | "trash";

export interface SweepActionSignal {
  pattern: string;
  kind: "sender" | "domain";
  action: SweepLearnAction;
  /** How many times the user confirmed this disposal. */
  weight: number;
  updatedAt: string;
}

export async function listSweepActions(): Promise<SweepActionSignal[]> {
  return readJson<SweepActionSignal[]>(SWEEP_ACTIONS, []);
}

/** Remember "this sender's mail goes to archive / trash" (sender + domain). */
export async function recordSweepAction(
  fromEmail: string,
  action: SweepLearnAction,
  now = new Date(),
): Promise<void> {
  const all = await listSweepActions();
  const domain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "";
  const upsert = (pattern: string, kind: SweepActionSignal["kind"]) => {
    if (!pattern) return;
    const ex = all.find((s) => s.kind === kind && s.pattern === pattern);
    if (ex) {
      // Same choice → more confident; changed mind → the new one wins.
      if (ex.action === action) ex.weight += 1;
      else {
        ex.action = action;
        ex.weight = 1;
      }
      ex.updatedAt = now.toISOString();
    } else {
      all.push({
        pattern,
        kind,
        action,
        weight: 1,
        updatedAt: now.toISOString(),
      });
    }
  };
  upsert(fromEmail, "sender");
  upsert(domain, "domain");
  await writeJson(SWEEP_ACTIONS, all);
}

/** Learned disposal for this sender (sender wins over domain); undefined = unknown. */
export function guessSweepAction(
  fromEmail: string,
  all: SweepActionSignal[],
): SweepLearnAction | undefined {
  const domain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "";
  const sender = all.find(
    (s) => s.kind === "sender" && s.pattern === fromEmail,
  );
  if (sender) return sender.action;
  return all.find((s) => s.kind === "domain" && s.pattern === domain)?.action;
}

/** A fast, non-AI heuristic guess using learned signals only. */
export function guessFromSignals(
  fromEmail: string,
  signals: ImportanceSignal[],
  projectKey?: string,
): Importance | undefined {
  // Most specific first: project (repo) > sender > domain. So a per-project
  // rule overrides a broad「github.com は低」and vice-versa.
  if (projectKey) {
    const proj = signals.find(
      (s) => s.kind === "project" && s.pattern === projectKey,
    );
    if (proj) return proj.importance;
  }
  const domain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "";
  const sender = signals.find(
    (s) => s.kind === "sender" && s.pattern === fromEmail,
  );
  if (sender) return sender.importance;
  const dom = signals.find((s) => s.kind === "domain" && s.pattern === domain);
  if (dom) return dom.importance;
  return undefined;
}

// ---------------------------------------------------------------------------
// 朝の一掃: 判断済みメールID — 一度さばいた（残す含む）メールは再提示しない。
// 毎回の再判定を防ぎAIコストを抑える＋「永遠に出てくる」解消。直近に絞る。
// ---------------------------------------------------------------------------
const SWEPT_IDS = "swept-ids.json";
const SWEPT_CAP = 8000;

export async function getSweptIds(): Promise<Set<string>> {
  return new Set(await readJson<string[]>(SWEPT_IDS, []));
}

export async function addSweptIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const cur = await readJson<string[]>(SWEPT_IDS, []);
  // 新しいものを末尾に積み、上限超過分は古いものから捨てる。
  const merged = [...cur.filter((id) => !ids.includes(id)), ...ids];
  await writeJson(SWEPT_IDS, merged.slice(-SWEPT_CAP));
}

// ── 連絡先メタデータ（ラベル/会社名/敬称/タグ）─────────────────────────
// 会社(ドメイン)単位を既定に、個人(アドレス)単位で上書き。実メールの宛名に
// 使うため creation は禁止（署名どおり／手入力のみ）。
const CONTACT_META = "contact-meta.json";

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

export async function listContactMeta(): Promise<ContactMeta[]> {
  return readJson<ContactMeta[]>(CONTACT_META, []);
}

/**
 * Upsert one entry (matched by scope+key). An entry with no meaningful fields
 * (no label/company/honorific/tags) is removed instead — so clearing the form
 * deletes the row rather than leaving an empty shell.
 */
export async function saveContactMeta(
  entry: Omit<ContactMeta, "updatedAt">,
  now = new Date(),
): Promise<ContactMeta[]> {
  const rows = await readJson<ContactMeta[]>(CONTACT_META, []);
  const key = entry.scope === "domain" ? entry.key.toLowerCase() : entry.key;
  const tags = (entry.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const empty =
    !entry.label &&
    !entry.company?.trim() &&
    !entry.honorific?.trim() &&
    tags.length === 0;
  const idx = rows.findIndex((r) => r.scope === entry.scope && r.key === key);
  if (empty) {
    if (idx >= 0) rows.splice(idx, 1);
  } else {
    const next: ContactMeta = {
      key,
      scope: entry.scope,
      label: entry.label,
      company: entry.company?.trim() || undefined,
      honorific: entry.honorific?.trim() || undefined,
      tags: tags.length ? tags : undefined,
      aiSuggested: entry.aiSuggested,
      updatedAt: now.toISOString(),
    };
    if (idx >= 0) rows[idx] = next;
    else rows.push(next);
  }
  await writeJson(CONTACT_META, rows);
  return rows;
}

/** Merge the company(domain) defaults with the person override for one address. */
export async function resolveContactMeta(
  email: string,
): Promise<ResolvedContactMeta> {
  const rows = await readJson<ContactMeta[]>(CONTACT_META, []);
  const dom = domainOf(email);
  const domain = rows.find((r) => r.scope === "domain" && r.key === dom);
  const person = rows.find(
    (r) => r.scope === "person" && r.key.toLowerCase() === email.toLowerCase(),
  );
  return {
    label: person?.label ?? domain?.label,
    company: person?.company ?? domain?.company,
    honorific: person?.honorific ?? domain?.honorific,
    tags: [...(domain?.tags ?? []), ...(person?.tags ?? [])],
  };
}

// ── TODO（「あとで」）───────────────────────────────────────────────
// メールを後で対応するタスクとして保持。local-first: .data のみ。
const TODOS = "todos.json";

export async function listTodos(): Promise<TodoItem[]> {
  return readJson<TodoItem[]>(TODOS, []);
}

/** Add a todo (no-op if the same email is already a todo — keeps existing due/done). */
export async function addTodo(
  item: Omit<TodoItem, "createdAt">,
  now = new Date(),
): Promise<TodoItem[]> {
  const rows = await readJson<TodoItem[]>(TODOS, []);
  if (!rows.some((r) => r.id === item.id)) {
    rows.push({ ...item, createdAt: now.toISOString() });
    await writeJson(TODOS, rows);
  }
  return rows;
}

/** Merge fields (due / done) into an existing todo. */
export async function updateTodo(
  id: string,
  patch: Partial<Pick<TodoItem, "due" | "done">>,
  now = new Date(),
): Promise<TodoItem[]> {
  const rows = await readJson<TodoItem[]>(TODOS, []);
  const row = rows.find((r) => r.id === id);
  if (row) {
    if ("due" in patch) row.due = patch.due || undefined;
    if ("done" in patch) {
      row.done = patch.done || undefined;
      row.doneAt = patch.done ? now.toISOString() : undefined;
    }
    await writeJson(TODOS, rows);
  }
  return rows;
}

export async function removeTodo(id: string): Promise<TodoItem[]> {
  const rows = await readJson<TodoItem[]>(TODOS, []);
  const kept = rows.filter((r) => r.id !== id);
  if (kept.length !== rows.length) await writeJson(TODOS, kept);
  return kept;
}
