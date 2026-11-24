import { NextResponse, after } from "next/server";
import { listAccounts, getProviderFor } from "@/lib/email/accounts";
import {
  cachedList,
  cachedStarred,
  existingIds,
  prunePendingSent,
  repliedThreadIds,
  threadCounts,
  upsertEmails,
} from "@/lib/db";
import {
  getEmailSettings,
  listSignals,
  listThreatSenders,
  listSafeSenders,
  listRules,
  getRulesAutoMark,
  setRulesAutoMark,
} from "@/lib/store";
import { applyRuleActionsForAccount } from "@/lib/rules-apply";
import { annotateImportance } from "@/lib/importance";
import { detectThreat } from "@/lib/threat";
import type { Email, FolderView, MailboxState } from "@/lib/types";
import { recordLog, errMsg } from "@/lib/logbuf";

export const dynamic = "force-dynamic";

/** API ids are account-qualified: `${account}/${providerId}`. */
function tag(account: string, e: Email): Email {
  return { ...e, account, id: `${account}/${e.id}` };
}

/**
 * Annotate each mail with conversation-level facts from the cache: 返信済み
 * (own sent message in the thread) and the true conversation size (threadCount,
 * spans folders) so the list badge matches what inline expansion shows.
 */
function markReplied(account: string, emails: Email[]): Email[] {
  const replied = repliedThreadIds(
    account,
    emails.map((e) => e.threadId),
  );
  const counts = threadCounts(
    account,
    emails.map((e) => e.threadId),
  );
  return emails.map((e) => ({
    ...e,
    ...(e.state !== "sent" && replied.has(e.threadId) ? { replied: true } : {}),
    threadCount: counts.get(e.threadId) ?? 1,
  }));
}

/**
 * Shared post-processing: enforce the per-account 受信箱の表示開始日 horizon,
 * layer free importance (learned signals > keyword), sort newest-first, cap.
 * Used by both the live and the cache-only paths so they stay identical.
 */
async function finalize(lists: Email[][], state: FolderView): Promise<Email[]> {
  const cfg = state === "inbox" ? await getEmailSettings() : null;
  const cutoffMs: Record<string, number> = {
    gmail: cfg
      ? +new Date(cfg.gmail?.inboxCutoff ?? cfg.inboxCutoff ?? NaN)
      : NaN,
    imap: cfg
      ? +new Date(cfg.imap?.inboxCutoff ?? cfg.inboxCutoff ?? NaN)
      : NaN,
  };
  const afterHorizon = (e: Email) => {
    const ms = cutoffMs[e.account ?? ""];
    return ms === undefined || Number.isNaN(ms) || +new Date(e.date) >= ms;
  };
  const signals = await listSignals();
  const threatSenders = await listThreatSenders();
  const safeSenders = await listSafeSenders();
  const annotated = annotateImportance(
    lists
      .flat()
      .filter(afterHorizon)
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .slice(0, LIST_CAP),
    signals,
  );
  // Flag dangerous mail (phishing/spam) for the list — free, offline, distinct
  // from importance. The AI refines this on open.
  return annotated.map((e) => {
    const threat = detectThreat(e, threatSenders, safeSenders);
    return threat ? { ...e, threat } : e;
  });
}

/** How many messages the list shows. The provider live-fetches only its newest
 *  window (Gmail 50); merging the cache + this higher cap keeps older inbox mail
 *  visible instead of vanishing behind the newest slice. Deeper history needs
 *  server pagination (planned). */
const LIST_CAP = 300;

/**
 * List emails for one account or all accounts (unified inbox).
 *   GET /api/emails?state=inbox&account=all|gmail|imap|mock
 * Live-fetches each account, writes through to the local SQLite cache, and
 * falls back to the cache for any account whose provider is unreachable.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = (url.searchParams.get("state") as FolderView) || "inbox";
  const account = url.searchParams.get("account") || "all";

  try {
    const accounts = await listAccounts();
    const targets =
      account === "all" ? accounts : accounts.filter((a) => a.key === account);
    if (!targets.length) {
      return NextResponse.json({ emails: [], accounts, stale: [] });
    }

    // スター付き is a cross-folder flag, not a mailbox — served from the
    // local cache (star state refreshes with every live folder fetch).
    if (state === "starred") {
      const signals = await listSignals();
      const emails = annotateImportance(
        targets
          .flatMap((a) =>
            markReplied(a.key, cachedStarred([a.key])).map((e) =>
              tag(a.key, e),
            ),
          )
          .sort((a, b) => +new Date(b.date) - +new Date(a.date)),
        signals,
      );
      return NextResponse.json({ emails, accounts, stale: [] });
    }

    // "vip" is a client-side inbox filter (sender labeled 重要取引先); the client
    // already maps it to "inbox" before fetching, but normalize defensively so a
    // stray "vip" never reaches a provider that only knows mailbox states.
    const mbox: MailboxState = state === "vip" ? "inbox" : state;

    // Cache-only fast path (?cached=1): serve the local SQLite instantly with
    // NO provider calls, so the UI can paint immediately and revalidate live
    // in the background (stale-while-revalidate). stale = all targets.
    if (url.searchParams.get("cached") === "1") {
      const lists = targets.map((a) =>
        markReplied(a.key, cachedList([a.key], mbox)).map((e) =>
          tag(a.key, e),
        ),
      );
      const emails = await finalize(lists, mbox);
      return NextResponse.json({
        emails,
        accounts,
        stale: targets.map((a) => a.key),
      });
    }

    const stale: string[] = [];
    // 受信時の自動ルール適用用に、今回の同期で初めてキャッシュに現れた受信メール
    // （＝新着）をアカウント別に拾っておく。upsert 前に existingIds で判定する。
    const freshInbox: { account: string; emails: Email[] }[] = [];
    const lists = await Promise.all(
      targets.map(async (a) => {
        try {
          const provider = await getProviderFor(a.key);
          const live = await provider.list(mbox);
          if (mbox === "inbox") {
            const have = existingIds(
              a.key,
              live.map((e) => e.id),
            );
            const fresh = live.filter((e) => !have.has(e.id));
            if (fresh.length) freshInbox.push({ account: a.key, emails: fresh });
          }
          upsertEmails(a.key, live); // write-through (raw provider ids)
          // Sent: drop optimistic `pending:` copies now that the real server
          // copy (same message_id) is in — avoids showing the sent mail twice.
          if (mbox === "sent") {
            prunePendingSent(
              a.key,
              live.map((e) => e.messageId ?? "").filter(Boolean),
            );
          }
          // Merge the local cache so inbox mail older than the provider's fetch
          // window (Gmail newest-50) stays visible. Live is authoritative for
          // the freshest slice → it overrides any stale cached copy; the cache
          // fills the older tail. Dedupe by raw provider id.
          const merged = new Map<string, Email>(
            cachedList([a.key], mbox, LIST_CAP).map((e) => [e.id, e]),
          );
          for (const e of live) merged.set(e.id, e);
          return markReplied(a.key, [...merged.values()]).map((e) =>
            tag(a.key, e),
          );
        } catch (err) {
          // Provider unreachable → serve the local cache for this account.
          stale.push(a.key);
          recordLog(
            "warn",
            "fetch",
            `${a.key}: 取得失敗、キャッシュを表示: ${errMsg(err)}`,
          );
          return markReplied(a.key, cachedList([a.key], mbox)).map((e) =>
            tag(a.key, e),
          );
        }
      }),
    );

    // Non-blocking backfill: the live list only fetches the provider's newest
    // window (Gmail 50), so mail that arrived while the app was closed — buried
    // under 50+ newer — never gets cached and silently vanishes from the inbox.
    // After responding, page the IDs and cache the missing ones (bounded per
    // load; self-limits to a cheap id-list call once caught up).
    if (state === "inbox") {
      after(async () => {
        for (const a of targets) {
          try {
            const provider = await getProviderFor(a.key);
            if (!provider.listIds) continue;
            const ids = await provider.listIds("inbox", 400);
            const have = existingIds(a.key, ids);
            const missing = ids.filter((id) => !have.has(id)).slice(0, 50);
            if (!missing.length) continue;
            const fetched = (
              await Promise.all(
                missing.map((id) => provider.get(id).catch(() => null)),
              )
            ).filter((e): e is Email => !!e);
            if (fetched.length)
              upsertEmails(
                a.key,
                fetched.map((e) => ({ ...e, html: undefined })),
              );
          } catch {
            /* backfill is best-effort */
          }
        }

        // 受信時の自動ルール適用（非破壊＝star / todo のみ。移動系は「今すぐ適用」）。
        // アカウント別の基準点（最後に処理した受信日時）より後に届いた新着だけに
        // 適用し、初回同期やキャッシュ再構築で受信箱全体へ一括適用する事故を防ぐ。
        try {
          const rules = (await listRules()).filter((r) => r.enabled);
          const hasAuto = rules.some((r) =>
            r.actions.some((act) => act.type === "star" || act.type === "todo"),
          );
          const marks = await getRulesAutoMark();
          const freshFor = (account: string) =>
            freshInbox.find((f) => f.account === account)?.emails ?? [];
          for (const a of targets) {
            const account = a.key;
            const fresh = freshFor(account);
            const markMs = marks[account] ? +new Date(marks[account]) : null;
            // 基準点が未設定（初回）＝基準点だけ立てて、既存／今回分には一切適用しない。
            // 以後、この時刻より後に届いた新着だけが自動適用の対象になる。
            if (markMs === null) {
              const base = fresh.reduce(
                (m, e) => Math.max(m, +new Date(e.date)),
                Date.now(),
              );
              await setRulesAutoMark(account, new Date(base).toISOString());
              continue;
            }
            // 基準点より後の新着だけ適用（star / todo のみ）。
            if (hasAuto) {
              const toApply = fresh.filter((e) => +new Date(e.date) > markMs);
              if (toApply.length) {
                await applyRuleActionsForAccount(account, toApply, rules, {
                  moves: false,
                });
              }
            }
            // 基準点を新着の最新へ前進（ルール有無に関わらず。後からルールを足しても
            // 過去分へ遡らないため）。
            const newest = fresh.reduce(
              (m, e) => Math.max(m, +new Date(e.date)),
              0,
            );
            if (newest > markMs) {
              await setRulesAutoMark(account, new Date(newest).toISOString());
            }
          }
        } catch {
          /* auto-apply is best-effort — never fail the list over it */
        }
      });
    }

    const emails = await finalize(lists, mbox);
    return NextResponse.json({ emails, accounts, stale });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to list" },
      { status: 500 },
    );
  }
}
