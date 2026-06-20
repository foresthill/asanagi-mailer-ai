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
  estUsd?: number;
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
