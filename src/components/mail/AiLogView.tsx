"use client";

import { useEffect, useState } from "react";
import { ScrollText, Loader2, ChevronRight } from "lucide-react";
import { relativeTime } from "./helpers";
import { useI18n } from "@/lib/i18n";
import { CostDashboard } from "./CostDashboard";

interface AiLogEntry {
  id: number;
  kind: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
  prompt: string | null;
  response: string | null;
  maskAudit: string | null;
  estUsd?: number;
}

/** Parse the mask-audit JSON stored per call → a compact display. */
function parseAudit(
  raw: string | null,
): { total: number; residual: number; masked: Record<string, number> } | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as {
      total?: number;
      residual?: number;
      masked?: Record<string, number>;
    };
    return {
      total: a.total ?? 0,
      residual: a.residual ?? 0,
      masked: a.masked ?? {},
    };
  } catch {
    return null;
  }
}

function usd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

/**
 * AIログ: every AI call this device made — the actual (PII-masked) prompt that
 * left the device, the reply, tokens and a cost estimate. Pure transparency
 * (local-first): nothing here is sent anywhere.
 */
export function AiLogView() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<AiLogEntry[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ai/log?limit=200");
        const data = await res.json();
        setEntries(data.entries ?? []);
      } catch {
        setEntries([]);
      }
    })();
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex items-center gap-3 border-b border-border bg-surface px-6 py-3.5">
        <ScrollText className="size-4 text-accent" />
        <h1 className="text-sm font-semibold">{t("nav.ailog")}</h1>
        {entries && (
          <span className="text-xs text-fg-subtle">
            {t("ailog.recent").replace("{n}", String(entries.length))}
          </span>
        )}
      </div>
      <p className="border-b border-border bg-surface-2 px-6 py-2 text-[11px] text-fg-muted">
        {t("ailog.intro")}
      </p>

      <CostDashboard />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {entries === null ? (
            <div className="grid h-40 place-items-center text-fg-subtle">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-subtle">
              {t("ailog.empty")}
            </p>
          ) : (
            entries.map((e) => {
              const open = openId === e.id;
              const audit = parseAudit(e.maskAudit);
              return (
                <div
                  key={e.id}
                  className="rounded-xl border border-border bg-surface"
                >
                  <button
                    onClick={() => setOpenId(open ? null : e.id)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
                  >
                    <ChevronRight
                      className={`size-3.5 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-90" : ""}`}
                    />
                    <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      {t(`ailog.kind.${e.kind}`) === `ailog.kind.${e.kind}`
                        ? e.kind
                        : t(`ailog.kind.${e.kind}`)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                      {e.model}
                    </span>
                    {audit && (
                      <span
                        title={
                          audit.residual > 0
                            ? t("ailog.audit.residualTitle").replace(
                                "{n}",
                                String(audit.residual),
                              )
                            : t("ailog.audit.cleanTitle").replace(
                                "{n}",
                                String(audit.total),
                              )
                        }
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                          audit.residual > 0
                            ? "bg-high-soft text-high"
                            : "bg-surface-2 text-fg-subtle"
                        }`}
                      >
                        🔒{audit.total}
                        {audit.residual > 0 ? ` ⚠${audit.residual}` : ""}
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">
                      in {e.inputTokens ?? "?"} / out {e.outputTokens ?? "?"}
                      {typeof e.estUsd === "number"
                        ? ` ≈ ${usd(e.estUsd)}`
                        : ""}
                    </span>
                    <span className="shrink-0 text-[11px] text-fg-subtle">
                      {relativeTime(e.createdAt)}
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-3 border-t border-border px-4 py-3">
                      {audit && (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase text-fg-subtle">
                            {t("ailog.audit.heading")}
                          </p>
                          <p className="text-[11px] leading-relaxed text-fg-muted">
                            {t("ailog.audit.masked").replace(
                              "{n}",
                              String(audit.total),
                            )}
                            {Object.keys(audit.masked).length > 0 && (
                              <>
                                （
                                {Object.entries(audit.masked)
                                  .map(([k, n]) => `${k}:${n}`)
                                  .join(" / ")}
                                ）
                              </>
                            )}
                            {" ・ "}
                            <span
                              className={
                                audit.residual > 0
                                  ? "font-semibold text-high"
                                  : ""
                              }
                            >
                              {t("ailog.audit.passed").replace(
                                "{n}",
                                String(audit.residual),
                              )}
                            </span>
                          </p>
                          <p className="mt-0.5 text-[10px] text-fg-subtle">
                            {t("ailog.audit.note")}
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase text-fg-subtle">
                          {t("ailog.prompt")}
                        </p>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-[11px] leading-relaxed text-fg">
                          {e.prompt ?? t("ailog.noRecord")}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase text-fg-subtle">
                          {t("ailog.response")}
                        </p>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-[11px] leading-relaxed text-fg">
                          {e.response ?? t("ailog.noRecord")}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
