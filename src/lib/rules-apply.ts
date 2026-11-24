import type { Email, MailRule } from "@/lib/types";
import { getProviderFor } from "@/lib/email/accounts";
import { addTodo, removeTodo } from "@/lib/store";
import { updateCached } from "@/lib/db";
import { resolveRuleActions } from "@/lib/rules";

/**
 * ルールのアクション適用（色以外＝star / todo / archive / junk）。
 *
 * - 受信時の自動適用は非破壊（star / todo）のみ：`moves: false` で呼ぶ。
 * - 「今すぐ適用」ボタンは移動系も含めて実行：`moves: true`。
 *
 * 既存のプロバイダ seam（setStarred / setStateBatch）とローカル TODO ストアだけを
 * 使い、新たな破壊的経路は作らない。id は各プロバイダの生ID（account 修飾なし）。
 * archive と junk が同時に当たったら junk を優先（移動先の競合回避）。
 * local-first: サーバ呼び出しは対象アカウントのプロバイダのみ。
 */
export interface ApplyResult {
  /** 生の providerId（star を付けた）。 */
  starred: string[];
  /** 生の providerId（アーカイブへ移動）。 */
  archived: string[];
  /** 生の providerId（迷惑メールへ移動）。 */
  junked: string[];
  /** account 修飾の TODO id（積んだ）。 */
  todos: string[];
}

function emptyResult(): ApplyResult {
  return { starred: [], archived: [], junked: [], todos: [] };
}

export async function applyRuleActionsForAccount(
  account: string,
  emails: Email[],
  rules: MailRule[],
  opts: { moves: boolean },
): Promise<ApplyResult> {
  const res = emptyResult();
  if (emails.length === 0 || rules.length === 0) return res;

  const starIds: string[] = [];
  const archiveIds: string[] = [];
  const junkIds: string[] = [];
  const todoDrafts: { id: string; e: Email }[] = [];

  for (const e of emails) {
    const acts = resolveRuleActions(e, rules);
    if (acts.size === 0) continue;
    if (acts.has("star") && !e.starred) starIds.push(e.id);
    if (acts.has("todo")) todoDrafts.push({ id: `${account}/${e.id}`, e });
    if (opts.moves) {
      if (acts.has("junk")) junkIds.push(e.id);
      else if (acts.has("archive")) archiveIds.push(e.id);
    }
  }

  const provider = await getProviderFor(account);

  // Star — no batch star in the provider seam; loop, best-effort per id.
  for (const id of starIds) {
    try {
      await provider.setStarred(id, true);
      try {
        updateCached(account, id, { starred: true });
      } catch {
        /* cache sync best-effort */
      }
      res.starred.push(id);
    } catch {
      /* skip this id; others continue */
    }
  }

  // Moves — one batch call per target state (so N mails ≠ N round-trips).
  if (junkIds.length) {
    try {
      await provider.setStateBatch(junkIds, "junk");
      for (const id of junkIds) {
        try {
          updateCached(account, id, { state: "junk" });
        } catch {
          /* best-effort */
        }
      }
      res.junked.push(...junkIds);
    } catch {
      /* batch failed → nothing moved */
    }
  }
  if (archiveIds.length) {
    try {
      await provider.setStateBatch(archiveIds, "archived");
      for (const id of archiveIds) {
        try {
          updateCached(account, id, { state: "archived" });
        } catch {
          /* best-effort */
        }
      }
      res.archived.push(...archiveIds);
    } catch {
      /* batch failed → nothing moved */
    }
  }

  // TODO — local, idempotent (addTodo no-ops if the id already exists).
  for (const { id, e } of todoDrafts) {
    try {
      await addTodo({
        id,
        account,
        kind: "message",
        threadId: e.threadId,
        anchorId: id,
        subject: e.subject,
        fromName: e.from.name,
        fromEmail: e.from.email,
        date: e.date,
      });
      res.todos.push(id);
    } catch {
      /* skip */
    }
  }

  return res;
}

/** 「今すぐ適用」の取り消し＝適用した変更を元に戻す（star解除・受信箱へ戻す・TODO削除）。 */
export async function undoRuleActionsForAccount(
  account: string,
  undo: ApplyResult,
): Promise<void> {
  const provider = await getProviderFor(account);

  for (const id of undo.starred) {
    try {
      await provider.setStarred(id, false);
      try {
        updateCached(account, id, { starred: false });
      } catch {
        /* best-effort */
      }
    } catch {
      /* skip */
    }
  }

  const backToInbox = [...undo.archived, ...undo.junked];
  if (backToInbox.length) {
    try {
      await provider.setStateBatch(backToInbox, "inbox");
      for (const id of backToInbox) {
        try {
          updateCached(account, id, { state: "inbox" });
        } catch {
          /* best-effort */
        }
      }
    } catch {
      /* skip */
    }
  }

  for (const id of undo.todos) {
    try {
      await removeTodo(id);
    } catch {
      /* skip */
    }
  }
}
