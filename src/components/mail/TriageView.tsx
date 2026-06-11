"use client";

import { useEffect, useState } from "react";
import { Loader2, ListChecks, Sparkles, Check } from "lucide-react";
import type { Importance } from "@/lib/types";
import type { Judgment } from "@/lib/db";
import { cn } from "@/lib/utils";
import { relativeTime } from "./helpers";

const IMPORTANCE_LABEL: Record<Importance, string> = {
  high: "重要",
  normal: "通常",
  low: "低",
};

const SOURCE_LABEL: Record<string, string> = {
  ai: "AI",
  heuristic: "簡易",
  learned: "学習済み",
};

function chipClass(i: Importance): string {
  return i === "high"
    ? "bg-high-soft text-high"
    : i === "low"
      ? "bg-surface-2 text-fg-subtle"
      : "bg-accent-soft text-accent";
}

/**
 * 仕分けレビュー: every importance judgment (AI / keyword / learned) with the
 * reason, reviewable by the user. A verdict click teaches the signal store
 * immediately AND accumulates as supervised training data for the future
 * local classifier (docs/02).
 */
export function TriageView() {
  const [items, setItems] = useState<Judgment[] | null>(null);
  const [stats, setStats] = useState<{ total: number; reviewed: number; agreed: number } | null>(
    null,
  );

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/judgments");
      const data = await res.json();
      setItems(data.items ?? []);
      setStats(data.stats ?? null);
    })();
  }, []);

  async function vote(j: Judgment, verdict: Importance) {
    // Optimistic update.
    setItems((prev) =>
      (prev ?? []).map((x) =>
        x.account === j.account && x.emailId === j.emailId ? { ...x, verdict } : x,
      ),
    );
    const res = await fetch("/api/judgments", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        account: j.account,
        emailId: j.emailId,
        fromEmail: j.fromEmail,
        verdict,
      }),
    });
    const data = await res.json();
    if (data.stats) setStats(data.stats);
  }

  const accuracy =
    stats && stats.reviewed > 0 ? Math.round((stats.agreed / stats.reviewed) * 100) : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex items-center gap-3 border-b border-border bg-surface px-6 py-3.5">
        <ListChecks className="size-4 text-accent" />
        <h1 className="text-sm font-semibold">仕分けレビュー</h1>
        {stats && (
          <span className="text-xs text-fg-subtle">
            判定 {stats.total}件・レビュー済み {stats.reviewed}件
            {accuracy !== null && `・一致率 ${accuracy}%`}
          </span>
        )}
      </div>
      <p className="border-b border-border bg-surface-2 px-6 py-2 text-[11px] text-fg-muted">
        AI/簡易判定の結果を確認して、正しい重要度を選んでください。あなたの判断は
        <strong>その場で学習</strong>され（次の一覧表示から反映）、将来のローカル分類器の
        <strong>教師データ</strong>として蓄積されます。
      </p>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {items === null ? (
            <div className="grid h-40 place-items-center text-fg-subtle">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-subtle">
              まだ判定ログがありません。メールを開くと判定が記録されていきます。
            </p>
          ) : (
            items.map((j) => (
              <div
                key={`${j.account}/${j.emailId}`}
                className="rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                      chipClass(j.importance),
                    )}
                  >
                    {IMPORTANCE_LABEL[j.importance]}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">
                    {j.source === "ai" && <Sparkles className="size-2.5" />}
                    {SOURCE_LABEL[j.source] ?? j.source}判定
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium">{j.subject}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-fg-subtle">
                    {relativeTime(j.createdAt)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-fg-subtle">
                  {j.fromName ?? j.fromEmail}
                  {j.reason ? `・${j.reason}` : ""}
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="mr-1 text-[11px] text-fg-subtle">あなたの判断:</span>
                  {(["high", "normal", "low"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => vote(j, v)}
                      className={cn(
                        "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                        j.verdict === v
                          ? "border-accent bg-accent-soft font-medium text-accent"
                          : "border-border text-fg-muted hover:border-accent hover:text-accent",
                      )}
                    >
                      {j.verdict === v && <Check className="size-3" />}
                      {IMPORTANCE_LABEL[v]}
                    </button>
                  ))}
                  {j.verdict && (
                    <span
                      className={cn(
                        "ml-2 text-[11px]",
                        j.verdict === j.importance ? "text-emerald-600" : "text-high",
                      )}
                    >
                      {j.verdict === j.importance ? "判定と一致" : "是正済み（学習に反映）"}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
