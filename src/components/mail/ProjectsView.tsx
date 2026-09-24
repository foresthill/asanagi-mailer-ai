"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import type { Project, ProjectHub } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/** Map AI-generated JP status/priority values → i18n keys (data stays JP). */
const STATUS_KEY: Record<string, string> = {
  進行中: "active",
  要確認: "check",
};
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
  const { t } = useI18n();
  const [hub, setHub] = useState<ProjectHub | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [prioF, setPrioF] = useState<PrioFilter>("all");

  useEffect(() => {
    let alive = true;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setHub(d);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t("projects.genFailed"));
      setHub(d);
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
          {(["all", "進行中", "要確認"] as StatusFilter[]).map((s) => (
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
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            {filtered.map((p, i) => (
              <div
                key={p.id}
                className={cn(
                  "grid grid-cols-1 gap-2 px-4 py-3.5 text-sm sm:grid-cols-[1.4fr_1.2fr_1fr_2fr] sm:gap-4",
                  i > 0 && "border-t border-border",
                )}
              >
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
