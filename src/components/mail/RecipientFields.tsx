"use client";

import { useCallback, useState } from "react";

export interface RecipientValues {
  to: string;
  cc: string;
  bcc: string;
}

/**
 * Gmail-style recipient rows: To always visible, Cc/Bcc revealed on demand
 * (auto-expanded when prefilled, e.g. reply-all). Long recipient lists WRAP
 * (auto-growing textarea) instead of scrolling horizontally. Values are
 * comma-separated; both `a@b.c` and `名前 <a@b.c>` forms are accepted
 * (compose.ts parses them at send time).
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

  // Grow the textarea to fit its content (1..6 lines).
  const autoGrow = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, []);

  const row = (
    label: string,
    key: keyof RecipientValues,
    placeholder: string,
    extra?: React.ReactNode,
  ) => (
    <div className="flex items-start gap-2 border-b border-border py-1.5">
      <span className="w-8 shrink-0 pt-0.5 text-xs text-fg-subtle">{label}</span>
      <textarea
        ref={autoGrow}
        value={values[key]}
        disabled={disabled}
        rows={1}
        onChange={(e) => {
          autoGrow(e.currentTarget);
          onChange({ ...values, [key]: e.target.value });
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent font-mono text-sm leading-6 outline-none placeholder:text-fg-subtle disabled:opacity-50"
      />
      {extra}
    </div>
  );

  return (
    <div className="flex flex-col">
      {row(
        "To",
        "to",
        "to@example.com（カンマ区切り・名前 <addr> も可）",
        <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px]">
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
