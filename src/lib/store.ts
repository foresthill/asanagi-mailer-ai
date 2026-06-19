import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AIProvider,
  AISettings,
  EmailSettings,
  ImportanceSignal,
  Importance,
  ScheduledSend,
  SavedDraft,
} from "@/lib/types";

/**
 * Tiny file-backed JSON store. Good enough for local MVP persistence
 * (mailbox state, scheduled sends, learned importance signals).
 * Swap for a real DB (e.g. a Marketplace Postgres) in a later phase.
 */
const DATA_DIR = path.join(process.cwd(), ".data");

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
  await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), "utf8");
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
export async function saveEmailSettings(patch: EmailSettings): Promise<EmailSettings> {
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
  return all.filter((s) => s.status === "scheduled" && new Date(s.sendAt) <= now);
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
  now = new Date(),
): Promise<void> {
  const signals = await listSignals();
  const domain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "";

  const upsert = (pattern: string, kind: ImportanceSignal["kind"]) => {
    if (!pattern) return;
    const existing = signals.find((s) => s.kind === kind && s.pattern === pattern);
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

  upsert(fromEmail, "sender");
  upsert(domain, "domain");
  await writeJson(SIGNALS, signals);
}

/** A fast, non-AI heuristic guess using learned signals only. */
export function guessFromSignals(
  fromEmail: string,
  signals: ImportanceSignal[],
): Importance | undefined {
  const domain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "";
  const sender = signals.find((s) => s.kind === "sender" && s.pattern === fromEmail);
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
