"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const noAutoFix = {
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;
const inputCls =
  "rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent";

/** Masked Gmail account fields served by GET /api/settings/accounts. */
export interface AccountGmailView {
  id: string;
  type: "gmail";
  label: string;
  address: string;
  connected: boolean;
  gmail: {
    address: string;
    inboxCutoff: string;
    clientIdSet: boolean;
    clientSecretSet: boolean;
    refreshTokenSet: boolean;
  };
}

/**
 * Add/edit one Gmail account (BYO OAuth client — advanced). Saves the
 * label + clientId/secret, then kicks off the Google consent flow threaded
 * with this account id so the refresh token lands on THIS account.
 * The existing single-Gmail OAuth flow is untouched (no accountId).
 */
export function AccountGmailForm({
  account,
  onSaved,
  onCancel,
  redirectUri,
}: {
  account?: AccountGmailView;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
  /** The callback URI the user must register in Google Cloud (display only). */
  redirectUri: string;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(account?.label ?? "");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [inboxCutoff, setInboxCutoff] = useState(account?.gmail.inboxCutoff ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientIdSet = account?.gmail.clientIdSet ?? false;
  const clientSecretSet = account?.gmail.clientSecretSet ?? false;

  /** Persist (POST new / PATCH edit) and return the account id. */
  async function save(): Promise<string | null> {
    const gmail: Record<string, string> = { inboxCutoff };
    if (clientId.trim()) gmail.clientId = clientId.trim();
    if (clientSecret.trim()) gmail.clientSecret = clientSecret.trim();
    const res = await fetch("/api/settings/accounts", {
      method: account ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(account ? { id: account.id } : {}),
        type: "gmail",
        label,
        gmail,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      error?: string;
    };
    if (!res.ok) {
      setError(data.error ?? `HTTP ${res.status}`);
      return null;
    }
    return account?.id ?? data.id ?? null;
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const id = await save();
      if (id) await onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const id = await save();
      if (!id) return;
      // Thread this account id so the callback writes the token to THIS account.
      window.location.href = `/api/auth/google?accountId=${encodeURIComponent(id)}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={onCancel}
        className="self-start text-[11px] text-fg-subtle hover:text-fg"
      >
        {t("accounts.back")}
      </button>

      <h4 className="text-[11px] font-semibold text-fg-muted">
        {account ? t("accounts.editGmail") : t("accounts.newGmail")}
      </h4>

      <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-fg-subtle">
        {t("accounts.gmailNote")}
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {t("accounts.labelField")}
        </span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("accounts.labelPlaceholder")}
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {t("gmail.clientId")}
          {clientIdSet && (
            <span className="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
              {t("gmail.set")}
            </span>
          )}
        </span>
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder={clientIdSet ? t("gmail.placeholder.changeOnly") : "xxxxx.apps.googleusercontent.com"}
          autoComplete="off"
          {...noAutoFix}
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {t("gmail.clientSecret")}
          {clientSecretSet && (
            <span className="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
              {t("gmail.set")}
            </span>
          )}
        </span>
        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={clientSecretSet ? t("gmail.placeholder.changeOnly") : ""}
          autoComplete="off"
          {...noAutoFix}
          className={inputCls}
        />
      </label>

      <p className="text-[11px] leading-relaxed text-fg-subtle">
        {t("gmail.note.before")}{" "}
        <code className="rounded bg-surface-2 px-1 font-mono text-[10px]">
          {redirectUri}
        </code>{" "}
        {t("gmail.note.after")}
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {t("email.cutoff.title")}
        </span>
        <input
          type="date"
          value={inboxCutoff}
          onChange={(e) => setInboxCutoff(e.target.value)}
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      {error && (
        <p className="rounded-lg bg-high-soft px-3 py-2 text-[11px] text-high">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={busy}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2 disabled:opacity-50"
        >
          {t("imap.save")}
        </button>
        <button
          onClick={handleConnect}
          disabled={busy}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {t("gmail.authBtn")}
        </button>
      </div>
    </div>
  );
}
