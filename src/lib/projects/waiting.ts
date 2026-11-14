import type { Email } from "@/lib/types";

/**
 * 誰待ち（docs/12）の決定論ロジック。案件のスレッドの「最新メールの方向」＋「経過日数」から、
 * 今ボールを持っているのが相手か自分かを決める。**LLM は一切使わない**（毎回ブレない・説明可能）。
 *
 * - 自分が最後に送った（送信箱 or from が自分のアドレス）→ 相手待ち（side="them"）
 * - 相手が最後だが、この会話に自分の返信がある（replied）→ 相手待ち（送信コピーが未キャッシュでも拾う）
 * - 相手が最後で未返信 → 自分待ち（要返信・side="me"）
 * - 判定材料なし（メール無し）→ null
 */
export type WaitingSide = "them" | "me";
export interface Waiting {
  side: WaitingSide;
  days: number;
}

export function computeWaiting(
  thread: Email[],
  myAddrs: Set<string>,
  now: number = Date.now(),
): Waiting | null {
  if (!thread.length) return null;
  const latest = thread.reduce((a, b) =>
    +new Date(b.date) > +new Date(a.date) ? b : a,
  );
  const days = Math.max(
    0,
    Math.floor((now - +new Date(latest.date)) / 86_400_000),
  );
  const sentByMe =
    latest.state === "sent" ||
    myAddrs.has((latest.from?.email ?? "").trim().toLowerCase());
  if (sentByMe) return { side: "them", days }; // 自分が最後 → 相手待ち
  if (latest.replied) return { side: "them", days }; // 受信だが返信済み → 相手待ち
  return { side: "me", days }; // 受信・未返信 → 自分待ち（要返信）
}
