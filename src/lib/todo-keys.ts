import type { Email, TodoItem } from "./types";

/**
 * TODO のキー設計。既定は「スレッド（会話）単位」、必要なときだけ「この1通だけ」。
 * - メールTODO:   id = `{account}/{providerId}`（= メールID そのもの）
 * - スレッドTODO: id = `{account}/thread:{threadId}`（メールIDと衝突しない名前空間）
 * 会話が進んでも1行にまとまり、スレッドを開けば最新まで追える（追従）。
 */

/** スレッドTODOの id を組み立てる（メールIDと別名前空間）。 */
export function threadTodoId(account: string, threadId: string): string {
  return `${account}/thread:${threadId}`;
}

/** そのメールが属する「スレッドTODOの id」。会話ID/アカウントが無ければ null。 */
export function emailThreadTodoId(
  email: Pick<Email, "account" | "threadId">,
): string | null {
  if (!email.account || !email.threadId) return null;
  return threadTodoId(email.account, email.threadId);
}

/**
 * このメールが（スレッド単位 or この1通で）TODO 済みか。
 * スレッドTODO があれば会話として済み、無くてもこの1通のメールTODO があれば済み。
 */
export function isEmailOnTodo(
  email: Pick<Email, "id" | "account" | "threadId">,
  threadTodoKeys: Set<string>,
  messageTodoIds: Set<string>,
): boolean {
  const tk = emailThreadTodoId(email);
  if (tk && threadTodoKeys.has(tk)) return true;
  return messageTodoIds.has(email.id);
}

/** todos を「スレッドTODOの id 集合」「メールTODOの id 集合」に分ける。 */
export function splitTodoKeys(todos: TodoItem[]): {
  threadTodoKeys: Set<string>;
  messageTodoIds: Set<string>;
} {
  const threadTodoKeys = new Set<string>();
  const messageTodoIds = new Set<string>();
  for (const t of todos) {
    if (t.kind === "thread") threadTodoKeys.add(t.id);
    else messageTodoIds.add(t.id);
  }
  return { threadTodoKeys, messageTodoIds };
}
