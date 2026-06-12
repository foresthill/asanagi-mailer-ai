"use client";

import { useCallback, useEffect, useState } from "react";

export interface RecipientValues {
  to: string;
  cc: string;
  bcc: string;
}

/** Minimal contact shape for the autocomplete (from /api/contacts). */
interface ContactHit {
  email: string;
  name?: string;
  self?: boolean;
}

/** Fragment being typed = text after the last comma/semicolon. */
function currentFragment(value: string): { head: string; frag: string } {
  const idx = Math.max(value.lastIndexOf(","), value.lastIndexOf("、"), value.lastIndexOf(";"));
  return { head: idx >= 0 ? value.slice(0, idx + 1) : "", frag: value.slice(idx + 1).trim() };
}

/**
 * Gmail-style recipient rows: To always visible, Cc/Bcc revealed on demand
 * (auto-expanded when prefilled, e.g. reply-all). Long recipient lists WRAP
 * (auto-growing textarea) instead of scrolling horizontally. Values are
 * comma-separated; both `a@b.c` and `名前 <a@b.c>` forms are accepted
 * (compose.ts parses them at send time).
 *
 * Typing filters the auto-derived address book (連絡先) and suggests
 * completions: ↑↓ to move, Enter/Tab/click to insert. IME-safe.
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
  const [contacts, setContacts] = useState<ContactHit[]>([]);
  const [activeField, setActiveField] = useState<keyof RecipientValues | null>(null);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    // One cheap cache-backed fetch per composer; suggestions filter locally.
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/contacts");
        const data = await res.json();
        if (active) setContacts((data.contacts ?? []) as ContactHit[]);
      } catch {
        /* autocomplete is progressive enhancement */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Grow the textarea to fit its content (1..6 lines).
  const autoGrow = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, []);

  const suggestionsFor = (key: keyof RecipientValues): ContactHit[] => {
    const { frag } = currentFragment(values[key]);
    if (frag.length < 1) return [];
    const q = frag.toLowerCase();
    const already = values[key].toLowerCase();
    return contacts
      .filter(
        (c) =>
          (c.email.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q)) &&
          !already.includes(c.email.toLowerCase()),
      )
      .slice(0, 6);
  };

  const insert = (key: keyof RecipientValues, c: ContactHit) => {
    const { head } = currentFragment(values[key]);
    const display = c.name ? `${c.name} <${c.email}>` : c.email;
    const next = `${head}${head ? " " : ""}${display}, `;
    onChange({ ...values, [key]: next });
    setHighlight(0);
  };

  const row = (
    label: string,
    key: keyof RecipientValues,
    placeholder: string,
    extra?: React.ReactNode,
  ) => {
    const open = activeField === key;
    const hits = open ? suggestionsFor(key) : [];
    return (
      <div className="relative flex items-start gap-2 border-b border-border py-1.5">
        <span className="w-8 shrink-0 pt-0.5 text-xs text-fg-subtle">{label}</span>
        <textarea
          ref={autoGrow}
          value={values[key]}
          disabled={disabled}
          rows={1}
          onChange={(e) => {
            autoGrow(e.currentTarget);
            onChange({ ...values, [key]: e.target.value });
            setHighlight(0);
          }}
          onFocus={() => {
            setActiveField(key);
            setHighlight(0);
          }}
          onBlur={() => {
            // Delay so a click on a suggestion (mousedown) lands first.
            setTimeout(() => setActiveField((f) => (f === key ? null : f)), 150);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || hits.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(hits.length - 1, h + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              insert(key, hits[Math.min(highlight, hits.length - 1)]);
            } else if (e.key === "Escape") {
              setActiveField(null);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent font-mono text-sm leading-6 outline-none placeholder:text-fg-subtle disabled:opacity-50"
        />
        {extra}
        {hits.length > 0 && (
          <ul className="absolute left-10 right-0 top-full z-30 mt-0.5 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow)]">
            {hits.map((c, i) => (
              <li key={c.email}>
                <button
                  type="button"
                  // mousedown beats the textarea blur, so the click registers.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insert(key, c);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    i === highlight ? "bg-accent-soft" : ""
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {c.name ? (
                      <>
                        <span className="font-medium">{c.name}</span>
                        {c.self && (
                          <span className="ml-1 rounded bg-accent-soft px-1 text-[10px] text-accent">自分</span>
                        )}
                        <span className="ml-1.5 text-xs text-fg-subtle">{c.email}</span>
                      </>
                    ) : (
                      <span className="font-mono text-xs">{c.email}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

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
