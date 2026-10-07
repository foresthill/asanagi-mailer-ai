"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2, Copy, Check, Activity } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * 動作ログ画面: 接続・送信・連携・AI などソフトの動作/失敗を、ファイルを cat せず
 * アプリ内で見るための画面。/api/logs（サーバ内リングバッファ）を読む。SMTP/IMAP の
 * 接続エラーなどはここに出る。新しい順・レベルで色分け・エラーのみ絞り込み・コピー/消去。
 */

type Level = "info" | "warn" | "error";
interface Entry {
  t: number;
  level: Level;
  scope: string;
  message: string;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function LogView() {
  const { t } = useI18n();
  const [logs, setLogs] = useState<Entry[]>([]);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/logs");
      const d = (await r.json()) as { logs?: Entry[] };
      setLogs(d.logs ?? []);
    } catch {
      /* best-effort */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // load() は fetch を await してから setState するので同期的な setState ではない。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // 軽くポーリング（開いている間だけ）して、操作直後の失敗もすぐ見えるように。
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  const shown = onlyErrors ? logs.filter((l) => l.level === "error") : logs;

  const clear = async () => {
    try {
      await fetch("/api/logs", { method: "DELETE" });
      setLogs([]);
    } catch {
      /* ignore */
    }
  };

  const copyAll = async () => {
    const text = shown
      .map((l) => `${fmtTime(l.t)} [${l.level}] ${l.scope}: ${l.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  };

  const dot = (lvl: Level) =>
    lvl === "error"
      ? "bg-high"
      : lvl === "warn"
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-3 px-6 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="size-5 text-accent" />
        <h1 className="text-lg font-semibold">{t("nav.logs")}</h1>
        <span className="text-xs text-fg-subtle">{t("log.desc")}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setOnlyErrors((v) => !v)}
            className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              onlyErrors
                ? "border-high bg-high-soft text-high"
                : "border-border text-fg-muted hover:border-fg-subtle"
            }`}
          >
            {t("log.onlyErrors")}
          </button>
          <button
            onClick={load}
            title={t("log.refresh")}
            className="grid size-7 place-items-center rounded-lg border border-border text-fg-muted hover:text-fg"
          >
            <RefreshCw className="size-3.5" />
          </button>
          <button
            onClick={copyAll}
            title={t("log.copy")}
            className="grid size-7 place-items-center rounded-lg border border-border text-fg-muted hover:text-fg"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-600" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
          <button
            onClick={clear}
            title={t("log.clear")}
            className="grid size-7 place-items-center rounded-lg border border-border text-fg-muted hover:text-high"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-surface">
        {loading ? (
          <p className="p-4 text-sm text-fg-subtle">…</p>
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-fg-subtle">
            {t("log.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((l, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 px-3 py-2 font-mono text-[12px] leading-relaxed"
              >
                <span
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot(l.level)}`}
                />
                <span className="shrink-0 tabular-nums text-fg-subtle">
                  {fmtTime(l.t)}
                </span>
                <span className="shrink-0 font-semibold text-accent">
                  {l.scope}
                </span>
                <span
                  className={`min-w-0 break-words ${l.level === "error" ? "text-high" : "text-fg"}`}
                >
                  {l.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-fg-subtle">{t("log.note")}</p>
    </div>
  );
}
