import { NextResponse } from "next/server";
import { listAccounts } from "@/lib/email/accounts";
import { cachedList } from "@/lib/db";
import { listRules } from "@/lib/store";
import {
  applyRuleActionsForAccount,
  undoRuleActionsForAccount,
  type ApplyResult,
} from "@/lib/rules-apply";
import { recordLog, errMsg } from "@/lib/logbuf";

export const dynamic = "force-dynamic";

/**
 * 「ルールを今すぐ適用」— 有効な全ルールのアクション（star / todo / archive / junk）を
 * 現在の受信箱（ローカルキャッシュ）へ一括適用する。移動系も含むので、受信時の自動
 * 適用（非破壊のみ）とは別に、ユーザーが明示実行する経路。
 *
 *  - POST {}            → 適用。結果サマリと取り消し用ペイロード(undo)を返す。
 *  - POST { undo: [...] } → 直前の適用を元に戻す（star解除 / 受信箱へ戻す / TODO削除）。
 *
 * local-first: サーバ呼び出しは各アカウントのプロバイダのみ。gmail.modify のため
 * アーカイブ/迷惑メール移動は完全削除ではなく、取り消しで受信箱へ戻せる。
 */

interface PerAccountUndo extends ApplyResult {
  account: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    undo?: PerAccountUndo[];
  };

  // ── 取り消し ──────────────────────────────────────────────
  if (Array.isArray(body.undo)) {
    for (const u of body.undo) {
      if (!u || typeof u.account !== "string") continue;
      try {
        await undoRuleActionsForAccount(u.account, {
          starred: u.starred ?? [],
          archived: u.archived ?? [],
          junked: u.junked ?? [],
          todos: u.todos ?? [],
        });
      } catch (err) {
        recordLog("error", "rules", `取り消し失敗 (${u.account}): ${errMsg(err)}`);
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ── 適用 ──────────────────────────────────────────────────
  const rules = (await listRules()).filter((r) => r.enabled);
  const actionable = rules.filter((r) =>
    r.actions.some(
      (a) =>
        a.type === "star" ||
        a.type === "todo" ||
        a.type === "archive" ||
        a.type === "junk",
    ),
  );
  if (actionable.length === 0) {
    return NextResponse.json({ ok: true, empty: true });
  }

  const accounts = await listAccounts();
  const undo: PerAccountUndo[] = [];
  const total: ApplyResult = { starred: [], archived: [], junked: [], todos: [] };
  let failed = false;

  for (const a of accounts) {
    try {
      const emails = cachedList([a.key], "inbox");
      const res = await applyRuleActionsForAccount(a.key, emails, rules, {
        moves: true,
      });
      if (
        res.starred.length ||
        res.archived.length ||
        res.junked.length ||
        res.todos.length
      ) {
        undo.push({ account: a.key, ...res });
        total.starred.push(...res.starred);
        total.archived.push(...res.archived);
        total.junked.push(...res.junked);
        total.todos.push(...res.todos);
      }
    } catch (err) {
      failed = true;
      recordLog("error", "rules", `今すぐ適用 失敗 (${a.key}): ${errMsg(err)}`);
    }
  }

  return NextResponse.json({
    ok: !failed,
    counts: {
      starred: total.starred.length,
      archived: total.archived.length,
      junked: total.junked.length,
      todos: total.todos.length,
    },
    undo,
  });
}
