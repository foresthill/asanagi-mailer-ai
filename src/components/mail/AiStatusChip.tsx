"use client";

import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Snapshot returned by GET /api/ai/status (never includes the key). */
type AiStatus = {
  provider: string;
  model: string;
  judgmentModel: string | null;
  source: "settings" | "env";
  configured: boolean;
  kind: "onprem" | "cloud";
  endpoint: string;
  /** true = live-reachable (on-prem probe), false = down/not-set, null = cloud (not pinged). */
  reachable: boolean | null;
  /** On-prem: configured model is actually installed. null = unknown (cloud/unreachable). */
  modelAvailable?: boolean | null;
  /** On-prem: model ids the endpoint serves right now. */
  availableModels?: string[];
  /** Configured standby fallback (on-prem only), or null. */
  fallback: { provider: string } | null;
  /** True when the tunnel is down and the cloud fallback is serving right now. */
  fallbackActive: boolean;
  /** What is actually answering while fallbackActive. */
  serving: { provider: string; model: string } | null;
};

const POLL_MS = 45_000;

/** Fired by the connection-settings dialog after AI settings are saved, so the
 *  sidebar chip re-reads /api/ai/status immediately instead of waiting for the
 *  next poll. Kept here (next to the only listener) as the single source. */
export const AI_STATUS_REFRESH_EVENT = "asanagi:ai-status-refresh";

/**
 * Always-visible chip in the sidebar footer showing which AI the app is wired to
 * right now, and — for on-prem endpoints — whether it is actually reachable (an
 * SSH tunnel dropping flips the dot to "未接続" without opening settings). Clicking
 * opens the connection settings. Cloud providers show "設定済み" (configured): we
 * do not ping them because a real request would cost a token.
 */
export function AiStatusChip({
  onOpenSettings,
  variant = "sidebar",
}: {
  onOpenSettings: () => void;
  /** "sidebar" = full-width footer button; "bar" = compact pill for a top bar. */
  variant?: "sidebar" | "bar";
}) {
  const { t } = useI18n();
  const [s, setS] = useState<AiStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false); // detail panel (why amber/red)

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/ai/status", { cache: "no-store" });
        if (alive && res.ok) setS((await res.json()) as AiStatus);
      } catch {
        /* keep the last snapshot on a transient error */
      } finally {
        if (alive) setLoaded(true);
      }
    };
    // Kick off via timers / events only — setState never runs synchronously in
    // the effect body (keeps react-hooks/set-state-in-effect happy).
    const first = setTimeout(load, 0);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    // 接続設定でAI設定を保存した直後に即再取得する。これが無いと、プロバイダを
    // 切替えても最大45秒（次のポーリング）まで旧プロバイダ表示のままになる。
    window.addEventListener(AI_STATUS_REFRESH_EVENT, onFocus);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(AI_STATUS_REFRESH_EVENT, onFocus);
    };
  }, []);

  // Dot colour + what's actually serving + short status word from the snapshot.
  let dot = "bg-fg-subtle";
  let label = t("aistatus.checking");
  // What is answering right now: normally the primary, but the cloud fallback
  // when the tunnel is down and fallback is serving (so the user sees bodies are
  // going to the cloud).
  let serving = s ? `${s.provider}:${s.model}` : "AI";
  let endpoint = s?.endpoint ?? "";
  if (s) {
    if (s.fallbackActive && s.serving) {
      // On-prem down → cloud is serving. Amber = "your bodies are on the cloud now".
      dot = "bg-amber-500";
      label = t("aistatus.fallback");
      serving = `${s.serving.provider}:${s.serving.model}`;
      endpoint = s.serving.provider;
    } else if (!s.configured) {
      dot = "bg-fg-subtle";
      label = t("aistatus.notset");
    } else if (s.reachable === true) {
      if (s.modelAvailable === false) {
        // Endpoint is up, but the configured model isn't installed there — the
        // one case where a "green tunnel" still can't generate. Amber, not green.
        dot = "bg-amber-500";
        label = t("aistatus.nomodel");
      } else {
        dot = "bg-emerald-500";
        label = t("aistatus.reachable");
      }
    } else if (s.reachable === false) {
      dot = "bg-high";
      label = t("aistatus.unreachable");
    } else {
      // Cloud, configured but not live-pinged.
      dot = "bg-emerald-500";
      label = t("aistatus.configured");
    }
  }

  const sub = endpoint ? `${label} · ${endpoint}` : label;

  // Why the chip is NOT green (localized one-liner). Green/cloud-configured =
  // null. The concrete specifics (missing model, endpoint, installed models)
  // are shown language-neutrally in the detail panel below the sentence.
  let reason: string | null = null;
  if (s) {
    if (s.fallbackActive && s.serving) reason = t("aistatus.reason.fallback");
    else if (!s.configured) reason = t("aistatus.reason.notset");
    else if (s.reachable === true && s.modelAvailable === false)
      reason = t("aistatus.reason.nomodel");
    else if (s.reachable === false) reason = t("aistatus.reason.unreachable");
  }

  const title = `${t("aistatus.open")}${s ? ` — ${serving} (${endpoint})` : ""}`;

  // Detail panel: opened by clicking the chip, so the reason for an amber/red
  // state is one click away (ユーザー要望: 黄/赤のとき、なぜそうなのかが見える)。
  const panel = (
    <div
      role="dialog"
      className="w-64 rounded-lg border border-border bg-surface p-3 text-left shadow-lg"
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
        <span className="truncate font-medium text-fg">{serving}</span>
        <span className="truncate text-fg-subtle">· {label}</span>
      </div>
      {reason && <p className="mt-2 text-[11px] leading-snug text-fg-muted">{reason}</p>}
      {/* Concrete specifics so the user can act (合わせる / 再接続). */}
      {(s?.modelAvailable === false || s?.reachable === false) && endpoint && (
        <div className="mt-1.5 break-all text-[10px] text-fg-subtle">{endpoint}</div>
      )}
      {s?.modelAvailable === false && !!s.availableModels?.length && (
        <div className="mt-1.5 text-[10px] text-fg-subtle">
          <span className="text-fg-muted">{t("aistatus.installed")}: </span>
          <span className="break-all">{s.availableModels.join(", ")}</span>
        </div>
      )}
      <button
        onClick={() => {
          setOpen(false);
          onOpenSettings();
        }}
        className="mt-2.5 w-full rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted transition-colors hover:bg-bg hover:text-fg"
      >
        {t("aistatus.open")}
      </button>
    </div>
  );

  const dotEl = (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", dot, !loaded && "animate-pulse")}
    />
  );

  // Compact pill for the always-visible top bar; clicking toggles the detail
  // panel (not straight to settings) so the "なぜ" is visible first.
  if (variant === "bar") {
    return (
      <div className="relative inline-flex">
        <button
          onClick={() => setOpen((o) => !o)}
          title={title}
          className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-fg-muted transition-colors hover:bg-surface hover:text-fg"
        >
          {dotEl}
          <span className="max-w-[200px] truncate font-medium">{serving}</span>
          <span className="truncate text-fg-subtle">· {sub}</span>
        </button>
        {open && (
          <>
            <button
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div className="absolute right-0 top-full z-50 mt-1">{panel}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={title}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-fg-subtle transition-colors hover:bg-surface hover:text-fg"
      >
        {dotEl}
        <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
          <span className="truncate">{serving}</span>
          <span className="truncate text-[10px] text-fg-subtle">{sub}</span>
        </span>
      </button>
      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute bottom-full left-0 z-50 mb-1">{panel}</div>
        </>
      )}
    </div>
  );
}
