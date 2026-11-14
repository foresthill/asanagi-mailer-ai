"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  EyeOff,
  Network,
  List,
  LayoutGrid,
} from "lucide-react";
import type { Project, ProjectHub } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { ProjectPartyGraph } from "./ProjectPartyGraph";

/** Map AI-generated JP status/priority values → i18n keys (data stays JP). */
const STATUS_KEY: Record<string, string> = {
  進行中: "active",
  要確認: "check",
  完了: "done",
};

/** ボード（docs/12 Phase C）の列順＝案件ステータス。 */
const BOARD_COLUMNS = ["進行中", "要確認", "完了"] as const;
const PRIO_KEY: Record<string, string> = { 高: "high", 中: "mid", 低: "low" };

type StatusFilter = "all" | "進行中" | "要確認";
type PrioFilter = "all" | "高" | "中";

function barClass(p: Project): string {
  if (p.status === "要確認") return "bg-fg-subtle";
  if (p.pct >= 80) return "bg-emerald-500";
  if (p.pct >= 40) return "bg-accent";
  return "bg-amber-500";
}

function PrioBadge({ p }: { p: Project["priority"] }) {
  const { t } = useI18n();
  const cls =
    p === "高"
      ? "bg-high-soft text-high"
      : p === "中"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
        : "bg-surface-2 text-fg-muted";
  return (
    <span
      className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", cls)}
    >
      {t(`projects.prio.${PRIO_KEY[p] ?? "mid"}`)}
    </span>
  );
}

/** 誰待ちチップ（docs/12）: 相手待ち（滞留日数つき・7日以上は強調）/ 自分待ち（要返信）。 */
function WaitingBadge({ w }: { w: NonNullable<Project["waiting"]> }) {
  const { t } = useI18n();
  if (w.side === "me") {
    return (
      <span className="rounded-full bg-high-soft px-2 py-0.5 text-[10px] font-semibold text-high">
        {t("projects.waiting.me")}
      </span>
    );
  }
  const stalled = w.days >= 7;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium",
        stalled
          ? "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
          : "bg-surface-2 text-fg-muted",
      )}
    >
      {t("projects.waiting.them").replace("{n}", String(w.days))}
    </span>
  );
}

/** ボードの1枚（docs/12 Phase C・読み取り専用の簡易カード）。列＝ステータスなので
 *  ステータスバッジは出さず、優先度・誰待ち・進捗・次アクションを縦に並べる。 */
function BoardCard({
  p,
  onOpenEmail,
  onExclude,
}: {
  p: Project;
  onOpenEmail?: (id: string) => void;
  onExclude: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="group relative rounded-lg border border-border bg-surface px-3 py-2.5">
      <button
        onClick={() => onExclude(p.id)}
        title={t("projects.exclude")}
        className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-high group-hover:opacity-100"
      >
        <EyeOff className="size-3" />
      </button>
      <div className="pr-5 text-[13px] font-semibold">{p.name}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <PrioBadge p={p.priority} />
        {p.waiting && <WaitingBadge w={p.waiting} />}
      </div>
      {p.parties.length > 0 && (
        <div className="mt-1 text-[11.5px] text-fg-muted">
          {p.parties
            .map((pt) => (pt.person ? `${pt.org} / ${pt.person}` : pt.org))
            .join("、")}
        </div>
      )}
      <div className="mt-1.5 text-[11px] font-medium">{p.statusLabel}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn("h-full rounded-full", barClass(p))}
          style={{ width: `${p.pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {p.due ? (
          <span className="rounded bg-high-soft px-1.5 py-0.5 text-[10px] font-semibold text-high">
            {p.due}
          </span>
        ) : (
          <span />
        )}
        {p.anchorId && onOpenEmail && (
          <button
            onClick={() => onOpenEmail(p.anchorId!)}
            className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-accent hover:underline"
          >
            {t("projects.openLatest")}
            <ArrowUpRight className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Which fields the client-side search scans. */
function haystack(p: Project): string {
  return [
    p.name,
    p.tag,
    p.statusLabel,
    p.next,
    p.memo,
    p.due,
    p.status,
    p.priority,
    p.parties.map((x) => `${x.org} ${x.person ?? ""}`).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * プロジェクト・ハブ — メール履歴から抽出した案件の一覧（進捗＋次アクション）。
 * データはローカルのAI抽出結果（/api/projects, .data/projects.json）。実データは
 * 端末外に出ない。更新は pull型（ボタンでメールキャッシュから再生成）。
 */
export function ProjectsView({
  onOpenEmail,
}: {
  onOpenEmail?: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [hub, setHub] = useState<ProjectHub | null>(null);
  const [excludedCount, setExcludedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [prioF, setPrioF] = useState<PrioFilter>("all");
  // 関係者マップ（docs/12 Phase B）を展開中の案件id（1件ずつ・on-demand）。
  const [graphId, setGraphId] = useState<string | null>(null);
  // 表示モード（docs/12 Phase C）: リスト / ボード（status列の読み取り専用カンバン）。
  const [viewMode, setViewMode] = useState<"list" | "board">("list");

  useEffect(() => {
    let alive = true;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setHub(d);
        setExcludedCount(d?.excludedCount ?? 0);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 無関係な案件を除外（＝ハブから外し、今後も出さないよう学習）。
  async function exclude(id: string) {
    setHub((h) =>
      h ? { ...h, projects: h.projects.filter((p) => p.id !== id) } : h,
    );
    try {
      const res = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const d = await res.json();
      if (res.ok) {
        setHub(d);
        setExcludedCount(d?.excludedCount ?? 0);
      }
    } catch {
      /* optimistic; a regenerate reconciles */
    }
  }

  // 除外の学習をリセット（次回の再生成で戻る）。
  async function resetExclusions() {
    try {
      await fetch("/api/projects/excluded", { method: "DELETE" });
      setExcludedCount(0);
    } catch {
      /* best-effort */
    }
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t("projects.genFailed"));
      setHub(d);
      setExcludedCount(d?.excludedCount ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("projects.genFailed"));
    } finally {
      setGenerating(false);
    }
  }

  const projects = useMemo(() => hub?.projects ?? [], [hub]);
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return projects.filter(
      (p) =>
        (statusF === "all" || p.status === statusF) &&
        (prioF === "all" || p.priority === prioF) &&
        (!kw || haystack(p).includes(kw)),
    );
  }, [projects, q, statusF, prioF]);

  // ボード用: filtered をステータス列に振り分け（ボード時 statusF は all に倒すので
  // 全列が出る）。読み取り専用＝ここで並べ替え/状態変更はしない（原本非複製・docs/12）。
  const boardCols = useMemo(() => {
    const g: Record<string, Project[]> = { 進行中: [], 要確認: [], 完了: [] };
    for (const p of filtered) (g[p.status] ??= []).push(p);
    return g;
  }, [filtered]);

  const kpi = {
    total: projects.length,
    active: projects.filter((p) => p.status === "進行中").length,
    high: projects.filter((p) => p.priority === "高").length,
    check: projects.filter((p) => p.status === "要確認").length,
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-end gap-2 px-5 pb-2 pt-5">
        <div className="flex-1">
          <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <Sparkles className="size-4 text-accent" />
            {t("projects.title")}
          </h1>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            {t("projects.desc")}
            {hub?.generatedAt && (
              <span className="ml-1">
                ／{" "}
                {t("projects.updated").replace(
                  "{date}",
                  new Date(hub.generatedAt).toLocaleString(undefined, {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                )}
              </span>
            )}
            {excludedCount > 0 && (
              <span className="ml-1">
                ／{" "}
                {t("projects.excludedCount").replace(
                  "{n}",
                  String(excludedCount),
                )}{" "}
                <button
                  onClick={resetExclusions}
                  className="underline hover:text-accent"
                >
                  {t("projects.excludedReset")}
                </button>
              </span>
            )}
          </p>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg shadow-sm hover:opacity-90 disabled:opacity-60"
        >
          {generating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {t("projects.refresh")}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* Search */}
        <div className="relative my-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("projects.search")}
            className="w-full rounded-xl border border-border bg-bg py-2.5 pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </div>

        {/* KPIs */}
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { n: kpi.total, l: t("projects.kpi.total"), hi: false },
            { n: kpi.active, l: t("projects.kpi.active"), hi: false },
            { n: kpi.high, l: t("projects.kpi.high"), hi: true },
            { n: kpi.check, l: t("projects.kpi.check"), hi: false },
          ].map((k) => (
            <div
              key={k.l}
              className="rounded-xl border border-border bg-surface px-3.5 py-2.5"
            >
              <div className={cn("text-xl font-bold", k.hi && "text-high")}>
                {k.n}
              </div>
              <div className="text-[11px] text-fg-subtle">{k.l}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px]">
          {/* ボードでは列＝ステータスなのでステータス絞り込みは隠す（statusF は all 固定）。 */}
          {viewMode === "list" &&
            (["all", "進行中", "要確認"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusF(s)}
                className={cn(
                  "rounded-full border px-3 py-1",
                  statusF === s
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-border text-fg-muted hover:border-accent hover:text-accent",
                )}
              >
                {s === "all"
                  ? t("projects.filter.all")
                  : t(`projects.status.${STATUS_KEY[s] ?? "active"}`)}
              </button>
            ))}
          {/* 表示モード切替（リスト / ボード）。ボードへ移るとき statusF を all に倒す。 */}
          <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
            <button
              onClick={() => setViewMode("list")}
              title={t("projects.view.list")}
              aria-pressed={viewMode === "list"}
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5",
                viewMode === "list"
                  ? "bg-accent text-accent-fg"
                  : "text-fg-muted hover:text-accent",
              )}
            >
              <List className="size-3.5" />
            </button>
            <button
              onClick={() => {
                setStatusF("all");
                setViewMode("board");
              }}
              title={t("projects.view.board")}
              aria-pressed={viewMode === "board"}
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5",
                viewMode === "board"
                  ? "bg-accent text-accent-fg"
                  : "text-fg-muted hover:text-accent",
              )}
            >
              <LayoutGrid className="size-3.5" />
            </button>
          </div>
          <span className="flex-1" />
          {(["all", "高", "中"] as PrioFilter[]).map((p) => (
            <button
              key={p}
              onClick={() => setPrioF(p)}
              className={cn(
                "rounded-full border px-3 py-1",
                prioF === p
                  ? "border-high bg-high text-white"
                  : "border-border text-fg-muted hover:border-high hover:text-high",
              )}
            >
              {p === "all"
                ? t("projects.filter.prioAll")
                : t(`projects.prio.${PRIO_KEY[p] ?? "mid"}`)}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-high/30 bg-high-soft px-3 py-2 text-xs text-high">
            {error}
          </p>
        )}

        {loading ? (
          <div className="grid h-40 place-items-center text-fg-subtle">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="grid place-items-center gap-2 py-16 text-center text-sm text-fg-subtle">
            <Sparkles className="size-8 opacity-40" />
            <p>{t("projects.empty")}</p>
          </div>
        ) : viewMode === "board" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {BOARD_COLUMNS.map((st) => (
              <div
                key={st}
                className="flex flex-col rounded-xl border border-border bg-surface-2/40"
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-xs font-semibold">
                    {t(`projects.status.${STATUS_KEY[st] ?? "active"}`)}
                  </span>
                  <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-muted">
                    {boardCols[st].length}
                  </span>
                </div>
                <div className="flex flex-col gap-2 p-2">
                  {boardCols[st].map((p) => (
                    <BoardCard
                      key={p.id}
                      p={p}
                      onOpenEmail={onOpenEmail}
                      onExclude={exclude}
                    />
                  ))}
                  {boardCols[st].length === 0 && (
                    <div className="px-2 py-8 text-center text-[11px] text-fg-subtle">
                      {t("projects.board.empty")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            {filtered.map((p, i) => (
              <div key={p.id} className={cn(i > 0 && "border-t border-border")}>
                <div className="group relative grid grid-cols-1 gap-2 px-4 py-3.5 pr-9 text-sm sm:grid-cols-[1.4fr_1.2fr_1fr_2fr] sm:gap-4">
                {/* 無関係な案件を除外（＋学習）。 */}
                <button
                  onClick={() => exclude(p.id)}
                  title={t("projects.exclude")}
                  className="absolute right-2 top-2.5 grid size-6 place-items-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-high group-hover:opacity-100"
                >
                  <EyeOff className="size-3.5" />
                </button>
                {/* Project + status */}
                <div>
                  <div className="font-semibold">{p.name}</div>
                  {p.tag && (
                    <div className="text-[11px] text-fg-subtle">{p.tag}</div>
                  )}
                  <div className="mt-1 flex items-center gap-1.5">
                    {p.status === "要確認" && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted">
                        {t("projects.status.check")}
                      </span>
                    )}
                    <PrioBadge p={p.priority} />
                    {p.waiting && <WaitingBadge w={p.waiting} />}
                  </div>
                  {p.anchorId && onOpenEmail && (
                    <button
                      onClick={() => onOpenEmail(p.anchorId!)}
                      className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline"
                    >
                      {t("projects.openLatest")}{" "}
                      <ArrowUpRight className="size-3" />
                    </button>
                  )}
                </div>
                {/* Parties */}
                <div className="text-[12.5px]">
                  {p.parties.map((pt, j) => (
                    <div key={j}>
                      <span className="font-medium">{pt.org}</span>
                      {pt.person && (
                        <span className="text-fg-muted"> / {pt.person}</span>
                      )}
                    </div>
                  ))}
                  {p.parties.length > 0 && (
                    <button
                      onClick={() =>
                        setGraphId((id) => (id === p.id ? null : p.id))
                      }
                      aria-expanded={graphId === p.id}
                      className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline"
                    >
                      <Network className="size-3" />
                      {graphId === p.id
                        ? t("projects.graph.hide")
                        : t("projects.graph.show")}
                    </button>
                  )}
                </div>
                {/* Progress */}
                <div className="min-w-[110px]">
                  <div className="text-[12px] font-medium">{p.statusLabel}</div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn("h-full rounded-full", barClass(p))}
                      style={{ width: `${p.pct}%` }}
                    />
                  </div>
                  <div className="mt-0.5 text-[11px] text-fg-subtle">
                    {p.pct}%
                  </div>
                </div>
                {/* Next action + memo */}
                <div className="text-[12.5px]">
                  {p.due && (
                    <span className="mb-1 mr-1 inline-block rounded bg-high-soft px-1.5 py-0.5 text-[11px] font-semibold text-high">
                      {p.due}
                    </span>
                  )}
                  <span>{p.next}</span>
                  {p.memo && (
                    <div className="mt-1 text-[11px] text-fg-subtle">
                      {p.memo}
                    </div>
                  )}
                </div>
                </div>
                {graphId === p.id && p.parties.length > 0 && (
                  <div className="border-t border-border bg-surface-2 px-4 py-3">
                    <div className="mb-1.5 text-[11px] font-medium text-fg-muted">
                      {t("projects.graph.title")}
                    </div>
                    <ProjectPartyGraph parties={p.parties} />
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-fg-subtle">
                {t("projects.noMatch")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
