"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  Inbox,
  Loader2,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Email } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, displayName } from "./helpers";
import { useI18n } from "@/lib/i18n";

type SweepAction = "keep" | "archive" | "trash" | "spam";

interface SweepItem {
  id: string;
  subject?: string;
  fromName?: string;
  fromEmail?: string;
  action: SweepAction;
  reason: string;
  source: "learned" | "heuristic" | "ai";
}

// setAll (header) offers the 3 safe dispositions; "spam" is per-row only —
// there is no "mark everything as spam" shortcut (too destructive).
const ACTIONS: { value: SweepAction; icon: typeof Archive }[] = [
  { value: "keep", icon: Inbox },
  { value: "archive", icon: Archive },
  { value: "trash", icon: Trash2 },
];
// Per-row selector adds 迷惑メール報告 (report as spam/phishing → learn + trash).
const ROW_ACTIONS: { value: SweepAction; icon: typeof Archive }[] = [
  ...ACTIONS,
  { value: "spam", icon: ShieldAlert },
];

/**
 * 朝の一掃 — 受信箱を開いた直後に、差出人・件名・プレビューだけの
 * 安価な一括判定で処分を提案し、各メールごとに「残す/アーカイブ/ゴミ箱」を
 * その場で振り替えてから一括実行する（受信箱が澄む朝の儀式）。本文はAIに送らない。
 */
export function SweepDialog({
  emails,
  accountLabels,
  onApply,
  onClose,
}: {
  /** Current inbox emails (list payloads — no bodies needed). */
  emails: Email[];
  /** account key → short label; non-null shows an origin badge per row (so you
   *  can tell which mailbox each mail belongs to). Null when a single account. */
  accountLabels?: Record<string, string> | null;
  /** (archiveIds, trashIds) — applied per mail. */
  onApply: (archiveIds: string[], trashIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SweepItem[]>([]);
  /** AI推奨を初期値に、ユーザーが行ごとに上書きできる現在の処分。 */
  const [actions, setActions] = useState<Record<string, SweepAction>>({});
  const [applying, setApplying] = useState(false);
  /** 確定後の余韻: list=一覧 / sweeping=処分対象が払い出される / calm=凪いだ表示。 */
  const [phase, setPhase] = useState<"list" | "sweeping" | "calm">("list");
  const [error, setError] = useState<string | null>(null);
  /** 判定結果を1行ずつ「整えて」見せる演出用のカウンタ（表示行数）。 */
  const [revealed, setRevealed] = useState(0);
  /** AI判定が使えずキーワード判定にフォールバックした場合の注意書き。 */
  const [warning, setWarning] = useState<string | null>(null);
  /** 分割判定の残りが流れ込んでいる最中か（最初の結果は出つつ後続を待つ）。 */
  const [streaming, setStreaming] = useState(false);
  /** 朝の一凪の累計AIコスト（接続設定と同じ /api/ai/usage の sweep 分）。 */
  const [sweepCost, setSweepCost] = useState<{
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estUsd?: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    // List payloads only — from/subject/snippet (no bodies).
    const payload = emails.map((e) => ({
      id: e.id,
      from: e.from,
      subject: e.subject,
      snippet: e.snippet,
    }));
    // 一括ではなく小分けにして並行判定し、届いた塊から順に表示する（大きな一括
    // 呼び出しの長い待ちを避け、非同期に結果が流れ込む体感に）。各呼び出しも軽い。
    const CHUNK = 15;
    const chunks: (typeof payload)[] = [];
    for (let i = 0; i < payload.length; i += CHUNK)
      chunks.push(payload.slice(i, i + CHUNK));

    if (chunks.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }

    let remaining = chunks.length;
    let anyWarning = false;
    let anyError = false;
    setStreaming(true);

    const finishCost = async () => {
      try {
        const u = await fetch("/api/ai/usage");
        const ud = await u.json();
        const k = (ud.byKind ?? []).find(
          (x: { kind: string }) => x.kind === "sweep",
        );
        if (active && k) setSweepCost(k);
      } catch {
        /* cost line is informational */
      }
    };

    for (const chunk of chunks) {
      (async () => {
        try {
          const res = await fetch("/api/ai/sweep", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ emails: chunk }),
          });
          const data = await res.json().catch(() => ({}));
          if (!active) return;
          if (res.ok) {
            const list = (data.items ?? []) as SweepItem[];
            if (list.length) {
              setItems((prev) => [...prev, ...list]);
              setActions((prev) => ({
                ...prev,
                ...Object.fromEntries(list.map((i) => [i.id, i.action])),
              }));
            }
            if (data.warning) anyWarning = true;
          } else {
            anyError = true;
          }
        } catch {
          anyError = true;
        } finally {
          if (!active) return;
          setLoading(false); // 最初に返った塊で一覧を出す
          remaining -= 1;
          if (remaining === 0) {
            setStreaming(false);
            if (anyWarning) setWarning(t("sweep.warning"));
            // 全部失敗かつ結果ゼロのときだけエラー表示（部分成功は一覧を優先）。
            setItems((cur) => {
              if (anyError && cur.length === 0)
                setError(t("sweep.judgeFailed"));
              return cur;
            });
            void finishCost();
          }
        }
      })();
    }

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 判定が届いたら、行を1つずつ「整えて」いく（AIが1通ずつ捌いている体感）。
  // 進行（1件ずつ現れる）は常に行い、スライド/点滅の“動き”だけ reduced-motion 時に
  // CSS 側で抑える（globals.css）。1行あたり 50–120ms、全体で ~2s 以内に収める。
  useEffect(() => {
    if (loading || error || items.length === 0) return;
    const total = items.length;
    // Stagger so it reads as a wave: brisk for long lists (rows overlap the
    // 0.45s sweep), deliberate for short ones. Whole cascade stays ~≤2s.
    const step = Math.max(35, Math.min(90, Math.floor(1800 / total)));
    const timer = setInterval(() => {
      setRevealed((n) => {
        const next = n + 1;
        if (next >= total) clearInterval(timer);
        return Math.min(next, total);
      });
    }, step);
    return () => clearInterval(timer);
  }, [loading, error, items.length]);

  const byId = useMemo(() => new Map(emails.map((e) => [e.id, e])), [emails]);

  // 処分対象が先（ゴミ箱→アーカイブ→残す）に並ぶよう、AI推奨順で一度だけ整列。
  // 手動変更（各行のセレクタ）では並べ替えない — 押した行がその場で色だけ
  // 変わり、位置は動かない。再整列すると押した瞬間に行が別グループへ飛んで
  // 「バーっと振り分け」がしづらいため（deps は items のみ・actions を含めない）。
  const ordered = useMemo(() => {
    const rank: Record<SweepAction, number> = {
      spam: 0,
      trash: 1,
      archive: 2,
      keep: 3,
    };
    return [...items].sort((a, b) => rank[a.action] - rank[b.action]);
  }, [items]);

  const archiveCount = items.filter((i) => actions[i.id] === "archive").length;
  const trashCount = items.filter((i) => actions[i.id] === "trash").length;
  const spamCount = items.filter((i) => actions[i.id] === "spam").length;
  const actionable = archiveCount + trashCount + spamCount;
  // Cost transparency: how many actually hit the AI this run vs were free.
  const aiCount = items.filter((i) => i.source === "ai").length;
  const freeCount = items.length - aiCount;
  const usd = (n: number) =>
    n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

  /** 「なぎ払い」演出のウォッシュ色（判定＝行の運命を色で示す）。
   *  ゴミ箱=赤 / アーカイブ=青 / 残す=無し。CSS変数 --sweep-wash に渡す。 */
  const washFor = (action: SweepAction): string =>
    action === "spam"
      ? "color-mix(in srgb, var(--high) 45%, transparent)"
      : action === "trash"
        ? "color-mix(in srgb, var(--high) 30%, transparent)"
        : action === "archive"
          ? "color-mix(in srgb, var(--accent) 26%, transparent)"
          : "transparent";

  /** 全行を一括で同じ処分に（ヘッダの一括ボタン）。 */
  const setAll = (action: SweepAction) =>
    setActions(Object.fromEntries(items.map((i) => [i.id, action])));

  /** いま「from」の判定になっている行だけ、まとめて「to」へ振り替える。
   *  例: アーカイブ推奨をまとめてゴミ箱へ（数件だけ残してあとは削除の運用）。 */
  const convert = (from: SweepAction, to: SweepAction) =>
    setActions((prev) => {
      const next = { ...prev };
      for (const i of items)
        if ((prev[i.id] ?? i.action) === from) next[i.id] = to;
      return next;
    });

  /** 確定: アーカイブ/ゴミ箱を実行し、表示した全件（残す含む）を判定済みに
   *  記録して閉じる → 次回以降は出さない。キャンセル（閉じる/×/背景）は
   *  何も記録せず、次回また提示される。 */
  async function apply() {
    setApplying(true);
    // 処分対象を「払い出す」演出へ（keep はその場に残る）。サーバが速くても
    // 払い出しが目に入るよう、アニメ分の最低時間を確保してから凪ぎ表示に移る。
    setPhase("sweeping");
    try {
      const archiveIds = items
        .filter((i) => actions[i.id] === "archive")
        .map((i) => i.id);
      const trashIds = items
        .filter((i) => actions[i.id] === "trash")
        .map((i) => i.id);
      // 迷惑メール報告: spam rows are trashed like any other, and additionally
      // reported (threat learning) so detectThreat flags the sender next time.
      const spamItems = items.filter((i) => actions[i.id] === "spam");
      const spamIds = spamItems.map((i) => i.id);
      const sweepAnim = new Promise((r) => setTimeout(r, 600));
      await Promise.all([
        onApply(archiveIds, [...trashIds, ...spamIds]),
        sweepAnim,
      ]);
      // One threat report per distinct spam sender (best-effort learning).
      if (spamItems.length) {
        const seen = new Set<string>();
        await Promise.all(
          spamItems.map((i) => {
            const from = i.fromEmail ?? byId.get(i.id)?.from.email;
            if (!from || seen.has(from)) return Promise.resolve();
            seen.add(from);
            return fetch(`/api/emails/${encodeURIComponent(i.id)}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ reportSpam: { fromEmail: from } }),
            }).catch(() => {});
          }),
        );
      }
      try {
        await fetch("/api/sweep/reviewed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: items.map((i) => i.id) }),
        });
      } catch {
        /* 記録失敗は致命的でない */
      }
      // 確定した判断を学習へ。importance（keep=normal / それ以外=low）に加え、
      // 実際に選んだ処分（archive / trash）も送る — これが無いと archive と
      // trash を区別できず、毎回「アーカイブ→ゴミ箱」を押し直すことになる。
      try {
        const signals = items
          .map((i) => {
            const from = i.fromEmail ?? byId.get(i.id)?.from.email;
            const action = actions[i.id] ?? i.action;
            // spam is trashed; record it as a trash signal (the threat report
            // above carries the spam-specific learning).
            const learnAction = action === "spam" ? "trash" : action;
            return from
              ? {
                  fromEmail: from,
                  importance: action === "keep" ? "normal" : "low",
                  action: learnAction,
                }
              : null;
          })
          .filter(Boolean);
        if (signals.length) {
          await fetch("/api/sweep/learn", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ signals }),
          });
        }
      } catch {
        /* 学習は best-effort */
      }
      // 払い出しが済んだら、少しだけ「凪いだ」余韻を見せてから閉じる。
      setPhase("calm");
      await new Promise((r) => setTimeout(r, 900));
      onClose();
    } catch (e) {
      // 処分に失敗したら一覧へ戻し、理由を出す（勝手に閉じない）。
      setPhase("list");
      setError(
        e instanceof Error
          ? `${t("sweep.applyFailed")}: ${e.message}`
          : t("sweep.applyFailed"),
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <div className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">
            <Sparkles className="size-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <h2 className="text-sm font-semibold">
              {t("nav.sweep")}{" "}
              <span className="text-[10px] font-normal text-fg-subtle">
                {t("sweep.subtitle")}
              </span>
            </h2>
            <span className="text-[11px] text-fg-subtle">
              {t("sweep.desc")}
            </span>
          </div>
          <button
            onClick={onClose}
            className="ml-auto grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* min-h-0 is required: without it a flex child grows past the
            container and pushes the footer (確定) out of view. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-12 text-fg-subtle">
              <Loader2 className="size-5 animate-spin text-accent" />
              <p className="text-sm">
                {t("sweep.judging").replace("{n}", String(emails.length))}
              </p>
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-high">{error}</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-subtle">
              {t("sweep.calmEmpty")}
            </p>
          ) : phase === "calm" ? (
            <div className="animate-calm flex flex-col items-center gap-2 py-16 text-center">
              <span className="text-4xl">🌊</span>
              <p className="text-sm font-medium text-fg">
                {t("sweep.done.title")}
              </p>
              <p className="text-[11px] text-fg-subtle">
                {t("sweep.done.detail")
                  .replace("{archive}", String(archiveCount))
                  .replace("{trash}", String(trashCount))}
                {spamCount > 0 &&
                  t("sweep.spamClause").replace("{n}", String(spamCount))}
              </p>
            </div>
          ) : (
            <>
              {warning && (
                <p className="mb-2 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-300">
                  {warning}
                </p>
              )}
              {/* コスト透明性: 何通がAIに行ったか・本文は送っていないこと・累計額。 */}
              <div className="mb-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
                {t("sweep.cost.main").replace("{n}", String(aiCount))}
                {freeCount > 0 &&
                  ` ${t("sweep.cost.free").replace("{n}", String(freeCount))}`}
                {sweepCost && (
                  <>
                    {" "}
                    {t("sweep.cost.total").replace(
                      "{calls}",
                      sweepCost.calls.toLocaleString(),
                    )}
                    {typeof sweepCost.estUsd === "number"
                      ? t("sweep.cost.approx").replace(
                          "{usd}",
                          usd(sweepCost.estUsd),
                        )
                      : ""}
                    <span className="text-fg-subtle">
                      {t("sweep.cost.detail")}
                    </span>
                  </>
                )}
              </div>
              {/* 一括変更 */}
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-fg-subtle">
                <span className="flex items-center gap-2">
                  {t("sweep.setAll")}
                  {ACTIONS.map((a) => (
                    <button
                      key={a.value}
                      onClick={() => setAll(a.value)}
                      className="rounded-md border border-border px-2 py-0.5 hover:border-accent hover:text-accent"
                    >
                      {t(`sweep.action.${a.value}`)}
                    </button>
                  ))}
                </span>
                {/* 振り替え: 推奨はアーカイブ多めだが実際は大半を削除したい運用向け */}
                {archiveCount > 0 && (
                  <button
                    onClick={() => convert("archive", "trash")}
                    title={t("sweep.convertToTrash.title")}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:border-high hover:text-high"
                  >
                    <Archive className="size-3" />→<Trash2 className="size-3" />
                    {t("sweep.convertToTrash").replace(
                      "{n}",
                      String(archiveCount),
                    )}
                  </button>
                )}
                {trashCount > 0 && (
                  <button
                    onClick={() => convert("trash", "archive")}
                    title={t("sweep.convertToArchive.title")}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:border-accent hover:text-accent"
                  >
                    <Trash2 className="size-3" />→<Archive className="size-3" />
                    {t("sweep.convertToArchive").replace(
                      "{n}",
                      String(trashCount),
                    )}
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {ordered.slice(0, revealed).map((i) => {
                  const mail = byId.get(i.id);
                  // Prefer the fields the API echoed back; fall back to the
                  // local list, then (last resort) nothing — never the raw id.
                  const sender =
                    i.fromName ||
                    i.fromEmail ||
                    (mail ? displayName(mail.from) : "");
                  const subject = i.subject ?? mail?.subject ?? "";
                  const cur = actions[i.id] ?? i.action;
                  // どのメールアカウント（gmail / imap 等）のメールかを示すバッジ。
                  const acct = mail?.account;
                  const acctLabel =
                    accountLabels && acct
                      ? (accountLabels[acct] ?? acct)
                      : null;
                  return (
                    <div
                      key={i.id}
                      // Wash color = the verdict AT reveal (the animation plays
                      // once on mount, showing how this mail was dealt).
                      // Wash color follows the CURRENT disposition (so a manual
                      // archive→trash change sweeps out in the right color).
                      style={{ "--sweep-wash": washFor(cur) } as CSSProperties}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5",
                        // reveal on first show; on 確定, actionable rows 払い出し.
                        phase === "sweeping" && cur !== "keep"
                          ? "animate-sweep-out"
                          : phase === "list"
                            ? "animate-sweep-reveal"
                            : "",
                        cur === "keep" ? "opacity-55" : "",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="shrink-0 truncate text-xs font-medium">
                            {sender || t("sweep.unknownSender")}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                            {subject}
                          </span>
                          {mail?.date && (
                            <span className="shrink-0 text-[10px] tabular-nums text-fg-subtle">
                              {new Date(mail.date).toLocaleString(undefined, {
                                month: "numeric",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                          {acctLabel && (
                            <span
                              className="flex max-w-[110px] shrink-0 items-center gap-1 rounded-full border border-border bg-surface-2 px-1.5 py-px text-[9px] text-fg-muted"
                              title={t("sweep.account").replace(
                                "{label}",
                                acctLabel,
                              )}
                            >
                              <span
                                className="size-1.5 rounded-full"
                                style={{ background: avatarColor(acct ?? "") }}
                              />
                              <span className="truncate">{acctLabel}</span>
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-fg-subtle">
                          {i.reason}
                        </span>
                      </span>
                      {/* 4択セグメント: 残す / アーカイブ / ゴミ箱 / 迷惑 */}
                      <span className="flex shrink-0 items-center overflow-hidden rounded-lg border border-border">
                        {ROW_ACTIONS.map((a) => {
                          const on = cur === a.value;
                          return (
                            <button
                              key={a.value}
                              onClick={() =>
                                setActions((prev) => ({
                                  ...prev,
                                  [i.id]: a.value,
                                }))
                              }
                              title={t(`sweep.action.${a.value}`)}
                              className={cn(
                                "flex items-center gap-1 px-2 py-1 text-[11px] transition-colors",
                                on
                                  ? a.value === "spam"
                                    ? "bg-high text-white ring-1 ring-inset ring-white/40"
                                    : a.value === "trash"
                                      ? "bg-high text-white"
                                      : a.value === "archive"
                                        ? "bg-accent text-accent-fg"
                                        : "bg-surface-2 text-fg"
                                  : a.value === "spam"
                                    ? "text-high/70 hover:bg-high-soft hover:text-high"
                                    : "text-fg-subtle hover:bg-surface-2",
                              )}
                            >
                              <a.icon className="size-3" />
                              {on && (
                                <span>{t(`sweep.action.${a.value}`)}</span>
                              )}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
              {(revealed < ordered.length || streaming) && (
                <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-fg-subtle">
                  <Sparkles className="size-3 animate-pulse text-accent" />
                  {streaming
                    ? t("sweep.tidying.streaming").replace(
                        "{n}",
                        String(ordered.length),
                      )
                    : t("sweep.tidying.progress")
                        .replace("{revealed}", String(revealed))
                        .replace("{total}", String(ordered.length))}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            title={t("sweep.skip.title")}
            className="rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-surface-2"
          >
            {t("sweep.skip")}
          </button>
          <span className="text-[11px] text-fg-subtle">
            {t("sweep.summary")
              .replace("{archive}", String(archiveCount))
              .replace("{trash}", String(trashCount))
              .replace("{keep}", String(items.length - actionable))}
            {spamCount > 0 &&
              t("sweep.spamClause").replace("{n}", String(spamCount))}
          </span>
          <button
            onClick={apply}
            disabled={loading || applying || items.length === 0}
            title={t("sweep.apply.title")}
            className="ml-auto flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {applying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {t("sweep.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
