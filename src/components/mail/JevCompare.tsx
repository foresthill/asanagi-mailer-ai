"use client";

import { useState } from "react";
import { Loader2, Sparkles, Bot, Zap } from "lucide-react";
import type { Email, Importance } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

/**
 * 1通に対して現行の LLM 判定（Claude 等）と Jev（System One）を同時に走らせ、
 * 重要度・脅威・確信度・所要時間を横並びで見せる共有ブロック。接続設定内の
 * プレイグラウンド（JevPlayground）と、本文の「判定」タブ（ReaderAiPanel）の
 * 両方で使う。/api/ai/compare は教師ログに記録しない（試用）。
 */

type Threat = "spam" | "phishing" | null;

interface LlmResult {
  importance?: Importance;
  reason?: string;
  threat?: Threat;
  model?: string;
  ms?: number;
  error?: string;
}
interface JevResult {
  importance?: Importance;
  threat?: Threat;
  confidence?: number;
  endpoint?: "typesafe" | "openrouter" | null;
  ms?: number;
  error?: string;
  disabled?: boolean;
}

function ImpChip({ imp }: { imp?: Importance }) {
  const { t } = useI18n();
  if (!imp) return null;
  const cls =
    imp === "high"
      ? "bg-high-soft text-high"
      : imp === "low"
        ? "bg-surface-2 text-fg-subtle"
        : "bg-surface-2 text-fg-muted";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${cls}`}>
      {t(`importance.${imp}`)}
    </span>
  );
}

function ThreatChip({ threat }: { threat?: Threat }) {
  const { t } = useI18n();
  if (!threat) return null;
  return (
    <span className="rounded bg-high px-1.5 py-0.5 text-[11px] font-bold text-white">
      {t(`threat.${threat}.badge`)}
    </span>
  );
}

export function JevCompare({ email }: { email: Email | null }) {
  const { t, locale } = useI18n();
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<{ llm: LlmResult; jev: JevResult } | null>(
    null,
  );
  const [err, setErr] = useState<string | null>(null);
  // 別メールに切替えたら結果をリセットするのは、呼び出し側が key={email.id} で
  // このコンポーネントを remount して行う（effect 内 setState を避ける）。

  async function run() {
    if (!email) return;
    setRunning(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch("/api/ai/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, locale }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "比較に失敗しました");
      setRes(d as { llm: LlmResult; jev: JevResult });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "比較に失敗しました");
    } finally {
      setRunning(false);
    }
  }

  const endpointLabel = (ep?: "typesafe" | "openrouter" | null) =>
    ep === "openrouter"
      ? t("conn.jev.ep.openrouter")
      : ep === "typesafe"
        ? t("conn.jev.ep.typesafe")
        : "";

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={run}
        disabled={running || !email}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-accent-fg disabled:opacity-50"
      >
        {running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Zap className="size-3.5" />
        )}
        {t("play.run")}
      </button>

      {err && <p className="text-[11px] text-high">{err}</p>}

      {res && (
        <div className="grid grid-cols-2 gap-2">
          {/* LLM (Claude 等) */}
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-fg-muted">
              <Bot className="size-3.5" />
              {t("play.llm")}
            </div>
            {res.llm.error ? (
              <p className="text-[11px] text-high">{res.llm.error}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1">
                  <ImpChip imp={res.llm.importance} />
                  <ThreatChip threat={res.llm.threat} />
                </div>
                {res.llm.reason && (
                  <p className="line-clamp-3 text-[11px] leading-snug text-fg-subtle">
                    {res.llm.reason}
                  </p>
                )}
                <div className="mt-auto flex items-center justify-between pt-1 text-[10px] text-fg-subtle">
                  <span className="truncate font-mono">{res.llm.model}</span>
                  <span className="shrink-0 tabular-nums">{res.llm.ms}ms</span>
                </div>
              </>
            )}
          </div>

          {/* Jev */}
          <div className="flex flex-col gap-1.5 rounded-lg border border-accent/40 bg-accent-soft/40 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-accent">
              <Sparkles className="size-3.5" />
              Jev{" "}
              {res.jev.endpoint && (
                <span className="font-normal text-fg-subtle">
                  ({endpointLabel(res.jev.endpoint)})
                </span>
              )}
            </div>
            {res.jev.disabled ? (
              <p className="text-[11px] text-fg-subtle">{t("play.jevOff")}</p>
            ) : res.jev.error ? (
              <p className="text-[11px] text-high">{res.jev.error}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1">
                  <ImpChip imp={res.jev.importance} />
                  <ThreatChip threat={res.jev.threat} />
                </div>
                {typeof res.jev.confidence === "number" && (
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-surface-2">
                      <div
                        className="h-full rounded bg-accent"
                        style={{
                          width: Math.round(res.jev.confidence * 100) + "%",
                        }}
                      />
                    </div>
                    <span className="shrink-0 text-[10px] font-bold tabular-nums text-accent">
                      {Math.round(res.jev.confidence * 100)}%
                    </span>
                  </div>
                )}
                <div className="mt-auto flex items-center justify-between pt-1 text-[10px] text-fg-subtle">
                  <span>{t("play.confidence")}</span>
                  <span className="shrink-0 tabular-nums">{res.jev.ms}ms</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <p className="text-[10px] text-fg-subtle">{t("play.note")}</p>
    </div>
  );
}
