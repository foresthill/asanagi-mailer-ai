import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Local-only, best-effort version history of the *learned* state (importance
 * signals, AIへのメモ, reply signatures, self-notes) using git — so you can see
 * how the AI's personalization evolved over time (diffs + history).
 *
 * Safety (local-first):
 *  - The repo lives INSIDE .data with NO remote → nothing is ever pushed.
 *  - Only a fixed whitelist of NON-secret JSON is staged, via explicit
 *    `git add -- <files>` (never `git add .`). Plus a defensive .gitignore that
 *    allowlists exactly those files, so even a manual `git add .` in .data
 *    can't leak secrets. Credentials (ai-settings/email-settings) and the mail
 *    cache (asanagi.db) are never tracked.
 *  - Every git call is wrapped and errors are ignored. If git is missing or
 *    fails, this is a silent no-op — git is NOT a runtime dependency and the
 *    app is completely unaffected.
 */
const DATA_DIR = process.env.ASANAGI_DATA_DIR || path.join(process.cwd(), ".data");

// NON-secret learned state only. NEVER add secrets or the DB here.
const TRACKED = [
  "signals.json",
  "judgment-profile.json",
  "reply-signatures.json",
  "notes.json",
  "sweep-actions.json", // 朝の一凪で学習した処分（archive/trash）
];
const TRACKED_SET = new Set(TRACKED);

/** Is this store file part of the versioned learning history? */
export function isTracked(file: string): boolean {
  return TRACKED_SET.has(file);
}

/** Run a git command inside .data, ignoring all failures (best-effort). */
function git(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      execFile(
        "git",
        ["-C", DATA_DIR, "-c", "commit.gpgsign=false", ...args],
        { timeout: 8000 },
        () => resolve(), // ignore exit code / stderr — best-effort
      );
    } catch {
      resolve(); // git binary absent / spawn failure → no-op
    }
  });
}

let running = false;

async function commit(): Promise<void> {
  if (running) return; // coalesce overlapping runs
  running = true;
  try {
    if (!existsSync(path.join(DATA_DIR, ".git"))) {
      await git(["init"]);
      // Defensive allowlist: ignore everything except the tracked files, so a
      // stray `git add .` (in .data, by us or by hand) can never stage secrets.
      try {
        writeFileSync(
          path.join(DATA_DIR, ".gitignore"),
          ["# local-only learning history — allowlist", "*", ...TRACKED.map((f) => `!${f}`), "!.gitignore", ""].join(
            "\n",
          ),
          "utf8",
        );
      } catch {
        /* ignore */
      }
    }
    const present = TRACKED.filter((f) => existsSync(path.join(DATA_DIR, f)));
    if (!present.length) return;
    // Include .gitignore in the commit so it isn't left perpetually staged.
    if (existsSync(path.join(DATA_DIR, ".gitignore"))) present.unshift(".gitignore");
    await git(["add", "--", ...present]);
    // Commits only if these paths actually changed; a no-op commit exits
    // non-zero and is swallowed (no empty/noise commits).
    await git([
      "-c",
      "user.name=Asanagi",
      "-c",
      "user.email=asanagi@localhost",
      "commit",
      "-m",
      `learning ${new Date().toISOString()}`,
      "--only",
      "--",
      ...present,
    ]);
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a debounced snapshot. Rapid learning changes (e.g. several 重要
 * presses) batch into a single commit ~5s after the last change. Fire-and-
 * forget; never blocks the caller.
 */
export function snapshotLearning(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void commit();
  }, 5000);
  // Don't hold the process open just for a pending snapshot.
  (timer as { unref?: () => void }).unref?.();
}
