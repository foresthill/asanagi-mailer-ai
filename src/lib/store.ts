import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AIProvider,
  AISettings,
  ImportanceSignal,
  Importance,
  ScheduledSend,
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
