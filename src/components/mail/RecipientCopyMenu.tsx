"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check, ChevronDown } from "lucide-react";
import type { EmailAddress } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Dedupe by address (case-insensitive), order preserved, keep first name. */
function uniqueRecipients(list: EmailAddress[]): EmailAddress[] {
  const seen = new Set<string>();
  const out: EmailAddress[] = [];
  for (const a of list) {
    const e = a.email?.trim();
    if (!e || seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase());
    out.push({ name: a.name, email: e });
  }
  return out;
}

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false; // clipboard unavailable
  }
}

/**
 * Address copy menu covering all three granularities from one UI:
 *  - 全員をコピー (comma-separated) — per-mail or per-thread depending on `people`
 *  - 1件ずつ — click a row to copy just that address
 * `people` is the raw participant list (From+To+CC of a message, or the union
 * across a whole thread); it is de-duped here. Renders nothing if empty.
 */
export function RecipientCopyMenu({
  people,
  label = "宛先をコピー",
  className,
}: {
  people: EmailAddress[];
  label?: string;
  /** Applied to the outer wrapper (e.g. "mt-1" under a recipient line). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null); // "all" | email
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const list = uniqueRecipients(people);
  if (list.length === 0) return null;

  const flash = (key: string) => {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="宛先のメールアドレスをコピー（全員／1件ずつ）"
        className="flex items-center gap-1 text-[11px] text-fg-subtle hover:text-accent"
      >
        <Copy className="size-3" />
        {label}
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 z-30 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-[var(--shadow)]"
        >
          <button
            onClick={async () => {
              if (await copyText(list.map((a) => a.email).join(", ")))
                flash("all");
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium hover:bg-surface-2"
          >
            {copiedKey === "all" ? (
              <Check className="size-3.5 shrink-0 text-accent" />
            ) : (
              <Copy className="size-3.5 shrink-0" />
            )}
            {copiedKey === "all"
              ? "コピーしました"
              : `全員をコピー（${list.length}）`}
          </button>

          <div className="my-1 border-t border-border" />

          {list.map((a) => (
            <button
              key={a.email}
              onClick={async () => {
                if (await copyText(a.email)) flash(a.email);
              }}
              title={`${a.email} をコピー`}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
            >
              {copiedKey === a.email ? (
                <Check className="size-3.5 shrink-0 text-accent" />
              ) : (
                <Copy className="size-3.5 shrink-0 text-fg-subtle" />
              )}
              <span className="min-w-0 flex-1">
                {a.name && (
                  <span className="block truncate text-xs">{a.name}</span>
                )}
                <span className="block truncate text-[11px] text-fg-subtle">
                  {a.email}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
