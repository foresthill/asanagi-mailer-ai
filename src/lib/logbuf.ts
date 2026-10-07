/**
 * アプリ内「動作ログ」バッファ。接続・送信・連携・AI 判定など、外部とのやり取りや
 * 失敗を1か所に貯め、アプリ内の画面（/api/logs → 動作ログビュー）で見られるようにする。
 * ファイルを `cat` せずに原因を追えるのが目的。
 *
 * サーバ（ローカルの単一 Node プロセス＝dev も desktop も）内のメモリに保持する
 * リングバッファ。再起動で消える（直近の診断用途なので十分）。各行は stdout/stderr
 * にもミラーするので、デスクトップの server.log にも残る。
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  /** epoch ms */
  t: number;
  level: LogLevel;
  /** 発生元の区分（例: smtp / imap / gmail / send / schedule / openproject / ai）。 */
  scope: string;
  message: string;
}

const MAX = 500;
const buf: LogEntry[] = [];

/** Normalize any thrown value to a readable message. */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function recordLog(
  level: LogLevel,
  scope: string,
  message: string,
): void {
  const entry: LogEntry = {
    t: Date.now(),
    level,
    scope,
    message: String(message).slice(0, 2000),
  };
  buf.push(entry);
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  // Mirror to the process stream so the desktop server.log keeps a copy too.
  const line = `[${scope}] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Newest first, for display. */
export function getLogs(): LogEntry[] {
  return buf.slice().reverse();
}

export function clearLogs(): void {
  buf.length = 0;
}
