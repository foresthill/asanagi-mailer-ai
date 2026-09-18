"use client";

import { useEffect, useState } from "react";
import { Loader2, TrendingUp } from "lucide-react";

interface DailyRow {
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estUsd: number | null;
}
interface Usage {
  total: { calls: number; inputTokens: number; outputTokens: number };
  totalEstUsd: number | null;
  daily: DailyRow[];
  byKind: { kind: string; calls: number; inputTokens: number; outputTokens: number; estUsd?: number }[];
}

const KIND_LABEL: Record<string, string> = {
  reply: "返信生成",
  digest: "経緯要約",
  "search-digest": "AI検索",
  suggest: "添削",
  classify: "重要度判定",
  sweep: "朝の一凪",
  subject: "件名",
  signature: "署名",
  profile: "プロフィール",
  "writing-note": "文体メモ",
  projects: "案件抽出",
};

function usd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface px-3 py-2">
      <span className="text-[10px] text-fg-subtle">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * コストダッシュボード（AIログの上部）: 日次の推定コストを棒グラフで、今日/直近7日/
 * 直近30日の合計と、機能別の内訳を表示。価格が取れない時はトークンで代替表示。
 * 端末内の ai_usage 集計のみ（外部送信なし）。
 */
export function CostDashboard() {
  const [u, setU] = useState<Usage | null | "err">(null);
  // 「今」はマウント時に一度だけ確定（render中の Date.now/new Date() は不純で避ける）。
  const [now] = useState(() => Date.now());

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/ai/usage");
        if (!r.ok) throw new Error(String(r.status));
        setU((await r.json()) as Usage);
      } catch {
        setU("err");
      }
    })();
  }, []);

  if (u === null) {
    return (
      <div className="grid h-20 place-items-center border-b border-border bg-surface">
        <Loader2 className="size-4 animate-spin text-fg-subtle" />
      </div>
    );
  }
  if (u === "err") return null;

  const priced = u.totalEstUsd != null;
  const dayMap = new Map(u.daily.map((d) => [d.day, d]));
  // 直近14日（今日含む・空き日は0埋め）。
  const days: DailyRow[] = [];
  for (let i = 13; i >= 0; i--) {
    const key = ymd(new Date(now - i * 86_400_000));
    days.push(dayMap.get(key) ?? { day: key, calls: 0, inputTokens: 0, outputTokens: 0, estUsd: 0 });
  }
  const barVal = (d: DailyRow) => (priced ? (d.estUsd ?? 0) : d.inputTokens + d.outputTokens);
  const max = Math.max(1e-9, ...days.map(barVal));

  const todayKey = ymd(new Date(now));
  const weekCut = ymd(new Date(now - 6 * 86_400_000));
  const sumUsd = (pred: (d: DailyRow) => boolean) =>
    u.daily.filter(pred).reduce((s, d) => s + (d.estUsd ?? 0), 0);
  const todayUsd = dayMap.get(todayKey)?.estUsd ?? 0;
  const weekUsd = sumUsd((d) => d.day >= weekCut);
  const monthUsd = u.totalEstUsd ?? 0;

  const topKinds = [...u.byKind]
    .filter((k) => typeof k.estUsd === "number")
    .sort((a, b) => (b.estUsd ?? 0) - (a.estUsd ?? 0))
    .slice(0, 4);

  return (
    <div className="border-b border-border bg-surface-2 px-6 py-4">
      <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
        <TrendingUp className="size-3.5 text-accent" />
        AIコスト（推定）
        {!priced && (
          <span className="font-normal text-fg-subtle">— 価格を取得できず、トークン量で表示</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="今日" value={priced ? usd(todayUsd) : "—"} />
        <Stat label="直近7日" value={priced ? usd(weekUsd) : "—"} />
        <Stat label="直近30日" value={priced ? usd(monthUsd) : "—"} />
      </div>

      {/* 日次バー（直近14日）。 */}
      <div className="mt-4">
        <div className="mb-1 flex items-end justify-between text-[10px] text-fg-subtle">
          <span>直近14日{priced ? "の推定コスト" : "のトークン量"}</span>
          <span className="tabular-nums">最大 {priced ? usd(max) : max.toLocaleString()}</span>
        </div>
        <div className="flex h-24 items-end gap-1">
          {days.map((d) => {
            const v = barVal(d);
            const h = Math.round((v / max) * 100);
            const isToday = d.day === todayKey;
            return (
              <div
                key={d.day}
                title={`${d.day.slice(5)}: ${priced ? usd(d.estUsd ?? 0) : (d.inputTokens + d.outputTokens).toLocaleString() + "tok"} ・ ${d.calls}回`}
                className="group flex flex-1 flex-col items-center justify-end gap-1"
              >
                <div
                  className={
                    "w-full rounded-t transition-colors " +
                    (v > 0 ? (isToday ? "bg-accent" : "bg-accent/45 group-hover:bg-accent/70") : "bg-border")
                  }
                  style={{ height: `${Math.max(v > 0 ? 4 : 2, h)}%` }}
                />
                <span className="text-[8px] tabular-nums text-fg-subtle">{d.day.slice(8)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 機能別の内訳（コスト上位）。 */}
      {topKinds.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {topKinds.map((k) => (
            <span
              key={k.kind}
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px]"
            >
              <span className="text-fg-muted">{KIND_LABEL[k.kind] ?? k.kind}</span>
              <span className="font-medium tabular-nums text-accent">{usd(k.estUsd ?? 0)}</span>
              <span className="tabular-nums text-fg-subtle">{k.calls}回</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
