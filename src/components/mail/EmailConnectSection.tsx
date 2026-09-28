"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail, AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { GmailConnectSection, type GmailView } from "./GmailConnectSection";
import { ImapConnectSection, type ImapView } from "./ImapConnectSection";

export interface EmailView {
  active: string; // what actually runs: gmail | imap | mock | error
  choice: "auto" | "gmail" | "imap" | "mock";
  /** アカウント別の受信箱の表示開始日 (YYYY-MM-DD)。空 = 制限なし。 */
  cutoffs: { gmail: string; imap: string };
  gmail: GmailView;
  imap: ImapView;
}

const CHOICES: { value: EmailView["choice"]; labelKey: string }[] = [
  { value: "auto", labelKey: "email.choice.auto" },
  { value: "gmail", labelKey: "email.choice.gmail" },
  { value: "imap", labelKey: "email.choice.imap" },
  { value: "mock", labelKey: "email.choice.mock" },
];

/**
 * Email account settings: backend picker + Gmail connect + IMAP connect.
 * Fetches the masked settings view once and shares it with the children.
 */
export function EmailConnectSection() {
  const { t } = useI18n();
  const [view, setView] = useState<EmailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [savingCutoff, setSavingCutoff] = useState(false);

  async function saveCutoff(account: "gmail" | "imap", value: string) {
    setSavingCutoff(true);
    try {
      const res = await fetch("/api/settings/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cutoffs: { [account]: value } }),
      });
      if (res.ok) setView((await res.json()) as EmailView);
    } finally {
      setSavingCutoff(false);
    }
  }

  const refresh = useCallback(async () => {
    // Never leave the panel spinning forever: time out, and surface any error
    // with a retry instead of an infinite spinner (Linux desktop 500 / hang).
    setError(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch("/api/settings/email", { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setView((await res.json()) as EmailView);
    } catch (e) {
      setError(
        e instanceof Error && e.name === "AbortError"
          ? "timeout"
          : e instanceof Error
            ? e.message
            : "error",
      );
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    // Fetch the masked settings view on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function changeChoice(choice: string) {
    setSwitching(true);
    try {
      const res = await fetch("/api/settings/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice }),
      });
      setView((await res.json()) as EmailView);
    } finally {
      setSwitching(false);
    }
  }

  if (!view) {
    if (error) {
      return (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-xs text-fg-muted">
          <AlertCircle className="size-5 text-high" />
          <span>{t("email.loadError")}</span>
          <span className="break-all font-mono text-[10px] text-fg-subtle">
            {error}
          </span>
          <button
            onClick={refresh}
            className="mt-1 rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent"
          >
            {t("aisearch.retry")}
          </button>
        </div>
      );
    }
    return (
      <div className="grid place-items-center py-6 text-fg-muted">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  const providerRaw = t("email.provider." + view.active);
  const providerLabel =
    providerRaw === "email.provider." + view.active ? view.active : providerRaw;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Mail className="size-4 text-accent" />
        <h3 className="text-xs font-semibold">{t("email.accountTitle")}</h3>
        <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-fg-subtle">
          {t("email.current").replace("{provider}", providerLabel)}
        </span>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {t("email.backend")}
        </span>
        <select
          value={view.choice}
          disabled={switching}
          onChange={(e) => changeChoice(e.target.value)}
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
        >
          {CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {t(c.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-fg-muted">
          {t("email.cutoff.title")}
        </span>
        {[
          {
            key: "gmail" as const,
            label: t("email.cutoff.gmail"),
            show: view.gmail.connected,
          },
          {
            key: "imap" as const,
            label: t("email.cutoff.imap"),
            show: Boolean(view.imap.host || view.imap.envConfigured),
          },
        ]
          .filter((a) => a.show)
          .map((a) => (
            <div key={a.key} className="flex items-center gap-2">
              <span className="w-36 shrink-0 text-xs text-fg-muted">
                {a.label}
              </span>
              <input
                type="date"
                value={view.cutoffs[a.key]}
                disabled={savingCutoff}
                onChange={(e) => saveCutoff(a.key, e.target.value)}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
              />
              {view.cutoffs[a.key] && (
                <button
                  onClick={() => saveCutoff(a.key, "")}
                  disabled={savingCutoff}
                  className="rounded-lg border border-border px-2.5 py-2 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {t("email.cutoff.clear")}
                </button>
              )}
            </div>
          ))}
        <span className="text-[11px] leading-relaxed text-fg-subtle">
          {t("email.cutoff.note")}
        </span>
      </div>

      <GmailConnectSection gmail={view.gmail} onRefresh={refresh} />

      <div className="border-t border-border pt-4">
        <ImapConnectSection imap={view.imap} onRefresh={refresh} />
      </div>
    </div>
  );
}
