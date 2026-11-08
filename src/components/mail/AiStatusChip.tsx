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
  /** Configured standby fallback (on-prem only), or null. */
  fallback: { provider: string } | null;
  /** True when the tunnel is down and the cloud fallback is serving right now. */
  fallbackActive: boolean;
  /** What is actually answering while fallbackActive. */
  serving: { provider: string; model: string } | null;
};

const POLL_MS = 45_000;

/**
 * Always-visible chip in the sidebar footer showing which AI the app is wired to
 * right now, and — for on-prem endpoints — whether it is actually reachable (an
 * SSH tunnel dropping flips the dot to "未接続" without opening settings). Clicking
 * opens the connection settings. Cloud providers show "設定済み" (configured): we
 * do not ping them because a real request would cost a token.
 */
export function AiStatusChip({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n();
  const [s, setS] = useState<AiStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

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
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
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
      dot = "bg-emerald-500";
      label = t("aistatus.reachable");
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
  const title = `${t("aistatus.open")}${s ? ` — ${serving} (${endpoint})` : ""}`;

  return (
    <button
      onClick={onOpenSettings}
      title={title}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-fg-subtle transition-colors hover:bg-surface hover:text-fg"
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          dot,
          !loaded && "animate-pulse",
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
        <span className="truncate">{serving}</span>
        <span className="truncate text-[10px] text-fg-subtle">{sub}</span>
      </span>
    </button>
  );
}
