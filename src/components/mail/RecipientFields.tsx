"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { EmailAddress } from "@/lib/types";
import { formatAddressList, parseAddressList } from "./compose";

export interface RecipientValues {
  to: string;
  cc: string;
  bcc: string;
}

type FieldKey = keyof RecipientValues;

/** Minimal contact shape for the autocomplete (from /api/contacts). */
interface ContactHit {
  email: string;
  name?: string;
  self?: boolean;
}

/**
 * Gmail-style recipient rows with editable, draggable chips. To always
 * visible, Cc/Bcc revealed on demand (auto-expanded when prefilled, e.g.
 * reply-all). Each recipient is a chip you can:
 *   - CLICK to edit (chip turns back into editable text)
 *   - DRAG between To/Cc/Bcc
 *   - remove with ×
 * Typing in the inline input adds new ones (comma/Enter commits). Values stay
 * comma-separated strings so compose.ts parses them unchanged at send time.
 *
 * Typing filters the auto-derived address book (連絡先) and suggests
 * completions: ↑↓ to move, Enter/Tab/click to insert. IME-safe.
 *
 * Drafts are kept PER FIELD (not one shared string): switching focus or
 * editing a chip in one row never clobbers another row's in-progress text.
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
  const [activeField, setActiveField] = useState<FieldKey | null>(null);
  const [drafts, setDrafts] = useState<Record<FieldKey, string>>({ to: "", cc: "", bcc: "" });
  const [highlight, setHighlight] = useState(0);
  const [dropTarget, setDropTarget] = useState<FieldKey | null>(null);
  // Latest drafts, readable from delayed callbacks (onBlur commit) without
  // capturing a stale render value.
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  const inputRefs = useRef<Record<FieldKey, HTMLInputElement | null>>({
    to: null,
    cc: null,
    bcc: null,
  });
  // Source of an in-flight drag — dataTransfer alone isn't readable on dragover.
  const dragFrom = useRef<{ field: FieldKey; index: number } | null>(null);

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

  const tokensOf = useCallback((key: FieldKey) => parseAddressList(values[key]), [values]);

  const reveal = (key: FieldKey) => {
    if (key === "cc") setShowCc(true);
    if (key === "bcc") setShowBcc(true);
  };

  /** Append addresses to a field, de-duplicating by email. */
  const addTo = (key: FieldKey, add: EmailAddress[]) => {
    const cur = parseAddressList(values[key]);
    const seen = new Set(cur.map((a) => a.email.toLowerCase()));
    const merged = [...cur];
    for (const a of add) {
      const k = a.email.toLowerCase();
      if (k && !seen.has(k)) {
        seen.add(k);
        merged.push(a);
      }
    }
    onChange({ ...values, [key]: formatAddressList(merged) });
  };

  const removeAt = (key: FieldKey, index: number) => {
    const list = tokensOf(key);
    list.splice(index, 1);
    onChange({ ...values, [key]: formatAddressList(list) });
  };

  /** Click a chip → pull it back into the input for editing. */
  const editChip = (key: FieldKey, index: number) => {
    if (disabled) return;
    const list = tokensOf(key);
    const a = list[index];
    if (!a) return;
    list.splice(index, 1);
    onChange({ ...values, [key]: formatAddressList(list) });
    const text = a.name ? `${a.name} <${a.email}>` : a.email;
    setDrafts((d) => ({ ...d, [key]: text }));
    setActiveField(key);
    setHighlight(0);
    setTimeout(() => {
      const el = inputRefs.current[key];
      el?.focus();
      el?.select();
    }, 0);
  };

  /** Move one chip from one field to another in a single update (no clobber). */
  const moveToken = (from: FieldKey, index: number, to: FieldKey) => {
    if (from === to) return;
    const src = tokensOf(from);
    const moved = src[index];
    if (!moved) return;
    src.splice(index, 1);
    const dst = tokensOf(to);
    const exists = dst.some((a) => a.email.toLowerCase() === moved.email.toLowerCase());
    onChange({
      ...values,
      [from]: formatAddressList(src),
      [to]: exists ? formatAddressList(dst) : formatAddressList([...dst, moved]),
    });
    reveal(to);
  };

  /** Commit a field's typed text (minus any trailing separator) as new chips. */
  const commitDraft = (key: FieldKey, text?: string) => {
    const raw = text ?? draftsRef.current[key];
    const t = raw.replace(/[,;、]+\s*$/, "").trim();
    if (t) addTo(key, parseAddressList(t));
    setDrafts((d) => ({ ...d, [key]: "" }));
    setHighlight(0);
  };

  const suggestionsFor = (key: FieldKey): ContactHit[] => {
    const q = drafts[key].trim().toLowerCase();
    if (q.length < 1) return [];
    const already = values[key].toLowerCase();
    return contacts
      .filter(
        (c) =>
          (c.email.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q)) &&
          !already.includes(c.email.toLowerCase()),
      )
      .slice(0, 6);
  };

  const insertContact = (key: FieldKey, c: ContactHit) => {
    addTo(key, [{ email: c.email, name: c.name }]);
    setDrafts((d) => ({ ...d, [key]: "" }));
    setHighlight(0);
  };

  const row = (label: string, key: FieldKey, placeholder: string, extra?: React.ReactNode) => {
    const open = activeField === key;
    const hits = open ? suggestionsFor(key) : [];
    const chips = tokensOf(key);
    return (
      <div
        className={`relative flex items-start gap-2 border-b py-1.5 transition-colors ${
          dropTarget === key ? "border-accent bg-accent-soft/40" : "border-border"
        }`}
        onDragOver={(e) => {
          if (!dragFrom.current) return;
          e.preventDefault();
          setDropTarget(key);
        }}
        onDragLeave={(e) => {
          // Only clear when truly leaving the row (not entering a child).
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const src = dragFrom.current;
          dragFrom.current = null;
          setDropTarget(null);
          if (src) moveToken(src.field, src.index, key);
        }}
      >
        <span className="w-8 shrink-0 pt-1 text-xs text-fg-subtle">{label}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {chips.map((a, i) => (
            <span
              key={`${a.email}-${i}`}
              draggable={!disabled}
              onDragStart={(e) => {
                dragFrom.current = { field: key, index: i };
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", a.email);
              }}
              onDragEnd={() => {
                dragFrom.current = null;
                setDropTarget(null);
              }}
              title={`${a.name ? `${a.name} <${a.email}>` : a.email}（クリックで編集・ドラッグで移動）`}
              className="inline-flex max-w-[220px] cursor-grab items-center gap-1 rounded-full border border-border bg-surface py-0.5 pl-2 pr-1 text-xs active:cursor-grabbing"
            >
              <button
                type="button"
                onClick={() => editChip(key, i)}
                disabled={disabled}
                className="min-w-0 cursor-pointer truncate hover:text-accent"
              >
                {a.name ?? a.email}
              </button>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeAt(key, i)}
                  className="grid size-3.5 shrink-0 place-items-center rounded-full text-fg-subtle hover:bg-surface-2 hover:text-high"
                  aria-label="宛先を削除"
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
          <input
            ref={(el) => {
              inputRefs.current[key] = el;
            }}
            value={drafts[key]}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (/[,;、]\s*$/.test(v)) commitDraft(key, v);
              else {
                setDrafts((d) => ({ ...d, [key]: v }));
                setHighlight(0);
              }
            }}
            onFocus={() => {
              setActiveField(key);
              setHighlight(0);
            }}
            onBlur={() => {
              // Delay so a click on a suggestion (mousedown) lands first.
              // Commit OUTSIDE any state updater — calling the parent onChange
              // from inside one triggers React's "setState while rendering"
              // warning and can drop the render (suggestions flicker).
              setTimeout(() => {
                commitDraft(key);
                setActiveField((f) => (f === key ? null : f));
              }, 150);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Backspace" && drafts[key] === "" && chips.length > 0) {
                // Empty input + Backspace → edit the last chip (Gmail-like).
                e.preventDefault();
                editChip(key, chips.length - 1);
                return;
              }
              if (hits.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(hits.length - 1, h + 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(0, h - 1));
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  insertContact(key, hits[Math.min(highlight, hits.length - 1)]);
                  return;
                }
              } else if ((e.key === "Enter" || e.key === "Tab") && drafts[key].trim()) {
                e.preventDefault();
                commitDraft(key);
                return;
              }
              if (e.key === "Escape") setActiveField(null);
            }}
            placeholder={chips.length === 0 ? placeholder : ""}
            autoComplete="off"
            spellCheck={false}
            className="min-w-[8rem] flex-1 bg-transparent font-mono text-sm leading-6 outline-none placeholder:text-fg-subtle disabled:opacity-50"
          />
        </div>
        {extra}
        {hits.length > 0 && (
          <ul className="absolute left-10 right-0 top-full z-30 mt-0.5 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow)]">
            {hits.map((c, i) => (
              <li key={c.email}>
                <button
                  type="button"
                  // mousedown beats the input blur, so the click registers.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertContact(key, c);
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
        "to@example.com（カンマ/Enterで確定・チップはクリックで編集/ドラッグで移動）",
        <span className="flex shrink-0 items-center gap-1.5 pt-1 text-[11px]">
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
