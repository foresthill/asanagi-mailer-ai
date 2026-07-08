"use client";

import { useEffect, useState } from "react";
import { ScrollText, Loader2, ChevronRight } from "lucide-react";
import { relativeTime } from "./helpers";

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
    const a = JSON.parse(raw) as { total?: number; residual?: number; masked?: Record<string, number> };
    return { total: a.total ?? 0, residual: a.residual ?? 0, masked: a.masked ?? {} };
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<string, string> = {
  reply: "返信生成",
  suggest: "添削",
  classify: "重要度判定",
  sweep: "朝の一凪",
};

function usd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

/**
 * AIログ: every AI call this device made — the actual (PII-masked) prompt that
 * left the device, the reply, tokens and a cost estimate. Pure transparency
 * (local-first): nothing here is sent anywhere.
 */
export function AiLogView() {
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
        <h1 className="text-sm font-semibold">AIログ</h1>
        {entries && <span className="text-xs text-fg-subtle">直近 {entries.length}件</span>}
      </div>
      <p className="border-b border-border bg-surface-2 px-6 py-2 text-[11px] text-fg-muted">
        この端末が<strong>実際にAIへ送った内容</strong>（PIIマスク有効時は匿名化後＝端末から出た形そのまま）と返答を、
        新しい順に記録しています。すべて<strong>端末内のみ</strong>に保存（直近2,000件）。
      </p>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {entries === null ? (
            <div className="grid h-40 place-items-center text-fg-subtle">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-subtle">
              まだAIを呼び出していません。返信生成・添削・重要度判定・朝の一凪で記録されます。
            </p>
          ) : (
            entries.map((e) => {
              const open = openId === e.id;
              const audit = parseAudit(e.maskAudit);
              return (
                <div key={e.id} className="rounded-xl border border-border bg-surface">
                  <button
                    onClick={() => setOpenId(open ? null : e.id)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
                  >
                    <ChevronRight
                      className={`size-3.5 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-90" : ""}`}
                    />
                    <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      {KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{e.model}</span>
                    {audit && (
                      <span
                        title={
                          audit.residual > 0
                            ? `マスクを素通りした構造化PIIが ${audit.residual} 件（人名・住所は未検出）`
                            : `構造化PII ${audit.total} 件をマスク・素通り0`
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
                      {typeof e.estUsd === "number" ? ` ≈ ${usd(e.estUsd)}` : ""}
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
                            マスキング監査
                          </p>
                          <p className="text-[11px] leading-relaxed text-fg-muted">
                            マスク {audit.total} 件
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
                            <span className={audit.residual > 0 ? "font-semibold text-high" : ""}>
                              素通り {audit.residual} 件
                            </span>
                          </p>
                          <p className="mt-0.5 text-[10px] text-fg-subtle">
                            ※構造化PII（メール/電話/番号）のみ計測。人名・住所は未検出（NER未導入）。
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase text-fg-subtle">
                          送信内容（プロンプト）
                        </p>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-[11px] leading-relaxed text-fg">
                          {e.prompt ?? "(記録なし)"}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase text-fg-subtle">
                          返答
                        </p>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-[11px] leading-relaxed text-fg">
                          {e.response ?? "(記録なし)"}
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
