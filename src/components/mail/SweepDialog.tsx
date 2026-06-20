"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, Check, Inbox, Loader2, Sparkles, Trash2, X } from "lucide-react";
import type { Email } from "@/lib/types";
import { cn } from "@/lib/utils";
import { displayName } from "./helpers";

type SweepAction = "keep" | "archive" | "trash";

interface SweepItem {
  id: string;
  subject?: string;
  fromName?: string;
  fromEmail?: string;
  action: SweepAction;
  reason: string;
  source: "learned" | "heuristic" | "ai";
}

const ACTIONS: { value: SweepAction; label: string; icon: typeof Archive }[] = [
  { value: "keep", label: "残す", icon: Inbox },
  { value: "archive", label: "アーカイブ", icon: Archive },
  { value: "trash", label: "ゴミ箱", icon: Trash2 },
];

/**
 * 朝の一掃 — 受信箱を開いた直後に、差出人・件名・プレビューだけの
 * 安価な一括判定で処分を提案し、各メールごとに「残す/アーカイブ/ゴミ箱」を
 * その場で振り替えてから一括実行する（受信箱が澄む朝の儀式）。本文はAIに送らない。
 */
export function SweepDialog({
  emails,
  onApply,
  onClose,
}: {
  /** Current inbox emails (list payloads — no bodies needed). */
  emails: Email[];
  /** (archiveIds, trashIds) — applied per mail. */
  onApply: (archiveIds: string[], trashIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SweepItem[]>([]);
  /** AI推奨を初期値に、ユーザーが行ごとに上書きできる現在の処分。 */
  const [actions, setActions] = useState<Record<string, SweepAction>>({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** AI判定が使えずキーワード判定にフォールバックした場合の注意書き。 */
  const [warning, setWarning] = useState<string | null>(null);
  /** 朝の一凪の累計AIコスト（接続設定と同じ /api/ai/usage の sweep 分）。 */
  const [sweepCost, setSweepCost] = useState<{
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estUsd?: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/ai/sweep", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            // List payloads only — from/subject/snippet (no bodies).
            emails: emails.map((e) => ({
              id: e.id,
              from: e.from,
              subject: e.subject,
              snippet: e.snippet,
            })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error ? `判定に失敗しました: ${data.error}` : "判定に失敗しました");
        }
        if (!active) return;
        const list = (data.items ?? []) as SweepItem[];
        setItems(list);
        setActions(Object.fromEntries(list.map((i) => [i.id, i.action])));
        if (data.warning) setWarning(data.warning as string);
        // This run's usage is logged server-side during the POST above —
        // fetch the cumulative 朝の一凪 cost so it's visible right here.
        try {
          const u = await fetch("/api/ai/usage");
          const ud = await u.json();
          const k = (ud.byKind ?? []).find((x: { kind: string }) => x.kind === "sweep");
          if (active && k) setSweepCost(k);
        } catch {
          /* cost line is informational */
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "判定に失敗しました");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byId = useMemo(() => new Map(emails.map((e) => [e.id, e])), [emails]);

  // 処分対象が先（ゴミ箱→アーカイブ→残す）に並ぶよう、AI推奨順を保ちつつ
  // 「残す」を末尾へ。各行のセレクタで自由に変えられる。
  const ordered = useMemo(() => {
    const rank: Record<SweepAction, number> = { trash: 0, archive: 1, keep: 2 };
    return [...items].sort((a, b) => rank[actions[a.id] ?? a.action] - rank[actions[b.id] ?? b.action]);
  }, [items, actions]);

  const archiveCount = items.filter((i) => actions[i.id] === "archive").length;
  const trashCount = items.filter((i) => actions[i.id] === "trash").length;
  const actionable = archiveCount + trashCount;
  // Cost transparency: how many actually hit the AI this run vs were free.
  const aiCount = items.filter((i) => i.source === "ai").length;
  const freeCount = items.length - aiCount;
  const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

  /** 全行を一括で同じ処分に（ヘッダの一括ボタン）。 */
  const setAll = (action: SweepAction) =>
    setActions(Object.fromEntries(items.map((i) => [i.id, action])));

  /** いま「from」の判定になっている行だけ、まとめて「to」へ振り替える。
   *  例: アーカイブ推奨をまとめてゴミ箱へ（数件だけ残してあとは削除の運用）。 */
  const convert = (from: SweepAction, to: SweepAction) =>
    setActions((prev) => {
      const next = { ...prev };
      for (const i of items) if ((prev[i.id] ?? i.action) === from) next[i.id] = to;
      return next;
    });

  /** 確定: アーカイブ/ゴミ箱を実行し、表示した全件（残す含む）を判定済みに
   *  記録して閉じる → 次回以降は出さない。キャンセル（閉じる/×/背景）は
   *  何も記録せず、次回また提示される。 */
  async function apply() {
    setApplying(true);
    try {
      const archiveIds = items.filter((i) => actions[i.id] === "archive").map((i) => i.id);
      const trashIds = items.filter((i) => actions[i.id] === "trash").map((i) => i.id);
      await onApply(archiveIds, trashIds);
      try {
        await fetch("/api/sweep/reviewed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: items.map((i) => i.id) }),
        });
      } catch {
        /* 記録失敗は致命的でない */
      }
      // 確定した判断を送信者の学習シグナルへ（keep=normal / それ以外=low）。
      // 次回の判定（無料の簡易判定含む）がどんどん賢くなる。
      try {
        const signals = items
          .map((i) => {
            const from = i.fromEmail ?? byId.get(i.id)?.from.email;
            const action = actions[i.id] ?? i.action;
            return from
              ? { fromEmail: from, importance: action === "keep" ? "normal" : "low" }
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
      onClose();
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
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
              朝の一凪 <span className="text-[10px] font-normal text-fg-subtle">ひとなぎ</span>
            </h2>
            <span className="text-[11px] text-fg-subtle">
              AIの推奨を各行で変更できます（本文はAIに送りません）
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
              <p className="text-sm">受信箱{emails.length}通を判定中…</p>
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-high">{error}</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-subtle">
受信箱は凪いでいます 🌊
            </p>
          ) : (
            <>
              {warning && (
                <p className="mb-2 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-300">
                  {warning}
                </p>
              )}
              {/* コスト透明性: 何通がAIに行ったか・本文は送っていないこと・累計額。 */}
              <div className="mb-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
                今回 <strong className="text-fg">{aiCount}通</strong> をAIで判定（
                <strong>差出人・件名・冒頭140字のみ／本文は送信していません</strong>・まとめて1回の呼び出し）。
                {freeCount > 0 && ` 学習済み・簡易判定の${freeCount}通はAIを使っていません。`}
                {sweepCost && (
                  <>
                    {" "}朝の一凪の累計: {sweepCost.calls.toLocaleString("ja-JP")}回
                    {typeof sweepCost.estUsd === "number" ? `・約 ${usd(sweepCost.estUsd)}` : ""}
                    <span className="text-fg-subtle">（詳細は 接続設定 → AI使用量）</span>
                  </>
                )}
              </div>
              {/* 一括変更 */}
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-fg-subtle">
                <span className="flex items-center gap-2">
                  すべてを:
                  {ACTIONS.map((a) => (
                    <button
                      key={a.value}
                      onClick={() => setAll(a.value)}
                      className="rounded-md border border-border px-2 py-0.5 hover:border-accent hover:text-accent"
                    >
                      {a.label}
                    </button>
                  ))}
                </span>
                {/* 振り替え: 推奨はアーカイブ多めだが実際は大半を削除したい運用向け */}
                {archiveCount > 0 && (
                  <button
                    onClick={() => convert("archive", "trash")}
                    title="現在アーカイブ判定のものを、まとめてゴミ箱に変更（残したい数件だけ手で戻す）"
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:border-high hover:text-high"
                  >
                    <Archive className="size-3" />→<Trash2 className="size-3" />
                    アーカイブ{archiveCount}件をゴミ箱へ
                  </button>
                )}
                {trashCount > 0 && (
                  <button
                    onClick={() => convert("trash", "archive")}
                    title="現在ゴミ箱判定のものを、まとめてアーカイブに変更"
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:border-accent hover:text-accent"
                  >
                    <Trash2 className="size-3" />→<Archive className="size-3" />
                    ゴミ箱{trashCount}件をアーカイブへ
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {ordered.map((i) => {
                  const mail = byId.get(i.id);
                  // Prefer the fields the API echoed back; fall back to the
                  // local list, then (last resort) nothing — never the raw id.
                  const sender =
                    i.fromName || i.fromEmail || (mail ? displayName(mail.from) : "");
                  const subject = i.subject ?? mail?.subject ?? "";
                  const cur = actions[i.id] ?? i.action;
                  return (
                    <div
                      key={i.id}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5",
                        cur === "keep" ? "opacity-55" : "",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-xs font-medium">
                            {sender || "(差出人不明)"}
                          </span>
                          <span className="truncate text-xs text-fg-muted">{subject}</span>
                        </span>
                        <span className="text-[10px] text-fg-subtle">{i.reason}</span>
                      </span>
                      {/* 3択セグメント: 残す / アーカイブ / ゴミ箱 */}
                      <span className="flex shrink-0 items-center overflow-hidden rounded-lg border border-border">
                        {ACTIONS.map((a) => {
                          const on = cur === a.value;
                          return (
                            <button
                              key={a.value}
                              onClick={() =>
                                setActions((prev) => ({ ...prev, [i.id]: a.value }))
                              }
                              title={a.label}
                              className={cn(
                                "flex items-center gap-1 px-2 py-1 text-[11px] transition-colors",
                                on
                                  ? a.value === "trash"
                                    ? "bg-high text-white"
                                    : a.value === "archive"
                                      ? "bg-accent text-accent-fg"
                                      : "bg-surface-2 text-fg"
                                  : "text-fg-subtle hover:bg-surface-2",
                              )}
                            >
                              <a.icon className="size-3" />
                              {on && <span>{a.label}</span>}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            title="何も変更せず閉じます（次回また提示されます）"
            className="rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-surface-2"
          >
            今回はスキップ
          </button>
          <span className="text-[11px] text-fg-subtle">
            アーカイブ{archiveCount}・ゴミ箱{trashCount}・残す{items.length - actionable}
          </span>
          <button
            onClick={apply}
            disabled={loading || applying || items.length === 0}
            title="この内容で確定（残したメールも含め、次回の一凪には出ません）"
            className="ml-auto flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {applying ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
