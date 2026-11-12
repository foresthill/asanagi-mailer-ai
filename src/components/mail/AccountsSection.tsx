"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Mail,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  Check,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { AccountImapForm, type AccountImapView } from "./AccountImapForm";
import { AccountGmailForm, type AccountGmailView } from "./AccountGmailForm";

type AccountView = AccountImapView | AccountGmailView;

type Mode =
  | { kind: "list" }
  | { kind: "choose" }
  | { kind: "imap"; account?: AccountImapView }
  | { kind: "gmail"; account?: AccountGmailView };

/**
 * Multi-account connection settings (docs/11 Phase 2): the list of configured
 * mail accounts with add / edit / delete. Replaces the single-backend picker.
 * Each account's credentials are stored locally (.data) and never leave the
 * device. Reflects the Phase 1 resolution layer (accounts[] authoritative,
 * else derived from the legacy gmail/imap slots).
 */
export function AccountsSection() {
  const { t } = useI18n();
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountView[] | null>(null);
  const [activeId, setActiveId] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch("/api/settings/accounts", { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        accounts: AccountView[];
        activeAccountId?: string;
      };
      setAccounts(data.accounts);
      setActiveId(data.activeAccountId ?? "all");
      // Re-run the server component so the sidebar's メール設定済み/未設定 badge
      // updates after connect/disconnect (computed once on the server).
      router.refresh();
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
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function afterSave() {
    await refresh();
    setMode({ kind: "list" });
  }

  async function changeActive(id: string) {
    setActiveId(id);
    await fetch("/api/settings/accounts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeAccountId: id }),
    });
    await refresh();
  }

  async function remove(a: AccountView) {
    const ok = window.confirm(
      t("accounts.deleteConfirm").replace("{label}", a.label || a.address),
    );
    if (!ok) return;
    setBusyId(a.id);
    try {
      await fetch(`/api/settings/accounts?id=${encodeURIComponent(a.id)}`, {
        method: "DELETE",
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  const redirectUri =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/auth/google/callback`
      : "";

  // --- Loading / error gates -------------------------------------------------
  if (!accounts) {
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

  // --- Add/edit forms --------------------------------------------------------
  if (mode.kind === "imap") {
    return (
      <AccountImapForm
        account={mode.account}
        onSaved={afterSave}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }
  if (mode.kind === "gmail") {
    return (
      <AccountGmailForm
        account={mode.account}
        redirectUri={redirectUri}
        onSaved={afterSave}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }
  if (mode.kind === "choose") {
    return (
      <div className="flex flex-col gap-3">
        <button
          onClick={() => setMode({ kind: "list" })}
          className="self-start text-[11px] text-fg-subtle hover:text-fg"
        >
          {t("accounts.back")}
        </button>
        <h4 className="text-[11px] font-semibold text-fg-muted">
          {t("accounts.addChoose")}
        </h4>
        <button
          onClick={() => setMode({ kind: "imap" })}
          className="rounded-lg border border-border px-3 py-2.5 text-left text-sm hover:border-accent hover:text-accent"
        >
          {t("accounts.typeImap")}
        </button>
        <button
          onClick={() => setMode({ kind: "gmail" })}
          className="rounded-lg border border-border px-3 py-2.5 text-left text-sm hover:border-accent hover:text-accent"
        >
          {t("accounts.typeGmail")}
        </button>
      </div>
    );
  }

  // --- List ------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Mail className="size-4 text-accent" />
        <h3 className="text-xs font-semibold">{t("accounts.title")}</h3>
      </div>

      <p className="text-[11px] leading-relaxed text-fg-subtle">
        {t("accounts.note")}
      </p>

      {accounts.length === 0 ? (
        <p className="rounded-lg bg-surface-2 px-3 py-3 text-[11px] text-fg-subtle">
          {t("accounts.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-2 text-[10px] font-semibold text-fg-muted">
                {a.type === "gmail" ? "G" : "@"}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{a.label}</span>
                <span className="truncate text-[11px] text-fg-subtle">
                  {a.address || a.id}
                </span>
              </div>
              <span className="ml-auto flex items-center gap-2">
                {a.connected ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                    <Check className="size-3" />
                    {t("accounts.connected")}
                  </span>
                ) : (
                  <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">
                    {t("accounts.notConnected")}
                  </span>
                )}
                <button
                  onClick={() =>
                    setMode(
                      a.type === "gmail"
                        ? { kind: "gmail", account: a }
                        : { kind: "imap", account: a },
                    )
                  }
                  title={t("accounts.edit")}
                  className="rounded-md p-1 text-fg-muted hover:text-accent"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  onClick={() => remove(a)}
                  disabled={busyId === a.id}
                  title={t("accounts.delete")}
                  className="rounded-md p-1 text-fg-muted hover:text-high disabled:opacity-50"
                >
                  {busyId === a.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {accounts.length >= 2 && (
        <label className="flex flex-col gap-1.5 border-t border-border pt-3">
          <span className="text-xs font-medium text-fg-muted">
            {t("accounts.show")}
          </span>
          <select
            value={activeId}
            onChange={(e) => changeActive(e.target.value)}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="all">{t("accounts.showAll")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        onClick={() => setMode({ kind: "choose" })}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-fg-muted hover:border-accent hover:text-accent"
      >
        <Plus className="size-4" />
        {t("accounts.add")}
      </button>
    </div>
  );
}
