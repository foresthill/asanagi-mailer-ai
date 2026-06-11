"use client";

import { useState } from "react";

export interface RecipientValues {
  to: string;
  cc: string;
  bcc: string;
}

/**
 * Gmail-style recipient rows: To always visible, Cc/Bcc revealed on demand
 * (auto-expanded when prefilled, e.g. reply-all). Values are comma-separated
 * address strings; parsing happens at send time (compose.ts).
 */
export function RecipientFields({
  values,
  onChange,
  disabled,
}: {
  values: RecipientValues;
  onChange: (v: RecipientValues) => void;
  disabled?: boolean;
}) {
  const [showCc, setShowCc] = useState(Boolean(values.cc));
  const [showBcc, setShowBcc] = useState(Boolean(values.bcc));

  const row = (
    label: string,
    key: keyof RecipientValues,
    placeholder: string,
    extra?: React.ReactNode,
  ) => (
    <div className="flex items-center gap-2 border-b border-border py-1.5">
      <span className="w-8 shrink-0 text-xs text-fg-subtle">{label}</span>
      <input
        value={values[key]}
        disabled={disabled}
        onChange={(e) => onChange({ ...values, [key]: e.target.value })}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-fg-subtle disabled:opacity-50"
      />
      {extra}
    </div>
  );

  return (
    <div className="flex flex-col">
      {row(
        "To",
        "to",
        "to@example.com（カンマ区切りで複数）",
        <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
          {!showCc && (
            <button
              type="button"
              onClick={() => setShowCc(true)}
              className="text-fg-subtle hover:text-accent"
            >
              Cc
            </button>
          )}
          {!showBcc && (
            <button
              type="button"
              onClick={() => setShowBcc(true)}
              className="text-fg-subtle hover:text-accent"
            >
              Bcc
            </button>
          )}
        </span>,
      )}
      {showCc && row("Cc", "cc", "cc@example.com")}
      {showBcc && row("Bcc", "bcc", "bcc@example.com（他の受信者には見えません）")}
    </div>
  );
}
