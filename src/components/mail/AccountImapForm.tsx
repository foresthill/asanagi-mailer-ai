"use client";

import { useState } from "react";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { deriveSmtpHost } from "@/lib/email/smtp-host";

// Technical fields (hosts/addresses/ports) must never be auto-capitalized or
// auto-corrected — macOS/WebKit turned "imap.lolipop" into "Imap.lolipop".
const noAutoFix = {
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;

const inputCls =
  "rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent";

const GMAIL_DOMAINS = ["gmail.com", "googlemail.com"];
function gmailPreset(email: string): { host: string; smtpHost: string } | null {
  const dom = email.split("@")[1]?.trim().toLowerCase();
  return dom && GMAIL_DOMAINS.includes(dom)
    ? { host: "imap.gmail.com", smtpHost: "smtp.gmail.com" }
    : null;
}

/** Masked IMAP account fields served by GET /api/settings/accounts. */
export interface AccountImapView {
  id: string;
  type: "imap";
  label: string;
  address: string;
  connected: boolean;
  imap: {
    fromName: string;
    host: string;
    port: string;
    secure: string;
    user: string;
    archiveFolder: string;
    trashFolder: string;
    sentFolder: string;
    smtpHost: string;
    smtpPort: string;
    smtpSecure: string;
    smtpUser: string;
    smtpFrom: string;
    inboxCutoff: string;
    passwordSet: boolean;
    smtpPasswordSet: boolean;
  };
}

interface TestResult {
  ok: boolean;
  imap: { ok: boolean; total?: number; error?: string };
  smtp: { ok: boolean; error?: string };
}

const EMPTY_IMAP: AccountImapView["imap"] = {
  fromName: "",
  host: "",
  port: "",
  secure: "",
  user: "",
  archiveFolder: "",
  trashFolder: "",
  sentFolder: "",
  smtpHost: "",
  smtpPort: "",
  smtpSecure: "",
  smtpUser: "",
  smtpFrom: "",
  inboxCutoff: "",
  passwordSet: false,
  smtpPasswordSet: false,
};

/**
 * Add/edit one IMAP account. Posts to /api/settings/accounts (POST=new,
 * PATCH=edit). Credentials are saved locally (.data); blank SMTP fields fall
 * back to the IMAP values. On save it calls onSaved with the refreshed list.
 */
export function AccountImapForm({
  account,
  onSaved,
  onCancel,
}: {
  account?: AccountImapView;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const base = account?.imap ?? EMPTY_IMAP;
  const [label, setLabel] = useState(account?.label ?? "");
  const [form, setForm] = useState({ ...base, password: "", smtpPassword: "" });
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Typing a Gmail address fills the servers so the user only supplies
  // address + app password. Don't clobber a non-Gmail host the user set.
  const onUserChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const user = e.target.value;
    setForm((f) => {
      const preset = gmailPreset(user);
      const autofill =
        preset && (!f.host || f.host === "imap.gmail.com")
          ? { host: preset.host, smtpHost: preset.smtpHost }
          : {};
      return { ...f, user, ...autofill };
    });
  };
  const isGmail = Boolean(gmailPreset(form.user));

  /** Save (POST new / PATCH edit) and return the resulting account id. */
  async function save(): Promise<string | null> {
    const imap: Record<string, string> = {
      fromName: form.fromName,
      host: form.host,
      port: form.port,
      user: form.user,
      archiveFolder: form.archiveFolder,
      trashFolder: form.trashFolder,
      sentFolder: form.sentFolder,
      smtpHost: form.smtpHost,
      smtpPort: form.smtpPort,
      smtpUser: form.smtpUser,
      smtpFrom: form.smtpFrom,
      inboxCutoff: form.inboxCutoff,
    };
    // Only send passwords the user actually typed (blank would clear them).
    if (form.password.trim()) imap.password = form.password.trim();
    if (form.smtpPassword.trim()) imap.smtpPassword = form.smtpPassword.trim();

    const res = await fetch("/api/settings/accounts", {
      method: account ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(account ? { id: account.id } : {}),
        type: "imap",
        label,
        address: form.user,
        imap,
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
    setTest(null);
    try {
      const id = await save();
      if (id) await onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setError(null);
    setTest(null);
    try {
      const id = await save();
      if (!id) return;
      const res = await fetch("/api/settings/accounts/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const raw = await res.text();
      try {
        setTest(JSON.parse(raw) as TestResult);
      } catch {
        const detail = `HTTP ${res.status} ${raw.slice(0, 300) || "(本文なし)"}`;
        setTest({
          ok: false,
          imap: { ok: false, error: detail },
          smtp: { ok: false, error: detail },
        });
      }
      await onSaved();
    } catch (e) {
      const detail = e instanceof Error ? e.message : "error";
      setTest({
        ok: false,
        imap: { ok: false, error: detail },
        smtp: { ok: false, error: detail },
      });
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
        {account ? t("accounts.editImap") : t("accounts.newImap")}
      </h4>

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
        <span className="text-xs font-medium text-fg-muted">{t("imap.user")}</span>
        <input
          value={form.user}
          onChange={onUserChange}
          placeholder="you@example.com"
          autoComplete="off"
          {...noAutoFix}
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {t("imap.password")}
          {form.passwordSet && (
            <span className="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
              {t("imap.set")}
            </span>
          )}
        </span>
        <input
          type="password"
          value={form.password}
          onChange={set("password")}
          placeholder={
            form.passwordSet
              ? t("imap.placeholder.changeOnly")
              : t("imap.placeholder.appPassword")
          }
          autoComplete="off"
          {...noAutoFix}
          className={inputCls}
        />
      </label>

      {isGmail && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
          {t("imap.gmail.detected")}{" "}
          <a
            href="https://support.google.com/accounts/answer/185833"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-accent"
          >
            {t("imap.gmail.appPwLink")}
          </a>
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {t("imap.fromName")}
        </span>
        <input
          value={form.fromName}
          onChange={set("fromName")}
          placeholder={t("imap.fromName.placeholder")}
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {t("email.cutoff.title")}
        </span>
        <input
          type="date"
          value={form.inboxCutoff}
          onChange={set("inboxCutoff")}
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <details className="rounded-lg bg-surface-2 px-3 py-2">
        <summary className="cursor-pointer text-[11px] text-fg-muted">
          {t("imap.advanced")}
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">{t("imap.host")}</span>
              <input
                value={form.host}
                onChange={set("host")}
                placeholder="imap.example.com"
                {...noAutoFix}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">{t("imap.port")}</span>
              <input
                value={form.port}
                onChange={set("port")}
                placeholder="993"
                {...noAutoFix}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">
                {t("imap.smtpHost")}
              </span>
              <input
                value={form.smtpHost}
                onChange={set("smtpHost")}
                placeholder={deriveSmtpHost(form.host) || "smtp.example.com"}
                {...noAutoFix}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">
                {t("imap.smtpPort")}
              </span>
              <input
                value={form.smtpPort}
                onChange={set("smtpPort")}
                placeholder="465"
                {...noAutoFix}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">
                {t("imap.smtpUser")}
              </span>
              <input
                value={form.smtpUser}
                onChange={set("smtpUser")}
                placeholder={t("imap.placeholder.sameAsImap")}
                {...noAutoFix}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">
                {t("imap.smtpPassword")}
                {form.smtpPasswordSet ? t("imap.setParen") : ""}
              </span>
              <input
                type="password"
                value={form.smtpPassword}
                onChange={set("smtpPassword")}
                placeholder={t("imap.placeholder.sameAsImap")}
                autoComplete="off"
                {...noAutoFix}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">
                {t("imap.smtpFrom")}
              </span>
              <input
                value={form.smtpFrom}
                onChange={set("smtpFrom")}
                placeholder={t("imap.placeholder.sameAsUser")}
                {...noAutoFix}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">
                {t("imap.archiveFolder")}
              </span>
              <input
                value={form.archiveFolder}
                onChange={set("archiveFolder")}
                placeholder="Archive"
                {...noAutoFix}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">
                {t("imap.trashFolder")}
              </span>
              <input
                value={form.trashFolder}
                onChange={set("trashFolder")}
                placeholder="Trash"
                {...noAutoFix}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">
                {t("imap.sentFolder")}
              </span>
              <input
                value={form.sentFolder}
                onChange={set("sentFolder")}
                placeholder="Sent"
                {...noAutoFix}
                className={inputCls}
              />
            </label>
          </div>
        </div>
      </details>

      {error && (
        <p className="rounded-lg bg-high-soft px-3 py-2 text-[11px] text-high">
          {error}
        </p>
      )}

      {test && (
        <div
          className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-xs ${
            test.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-high-soft text-high"
          }`}
        >
          <span className="flex items-center gap-2">
            {test.imap.ok ? <Check className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            IMAP:{" "}
            {test.imap.ok
              ? t("imap.test.imapOk").replace("{n}", String(test.imap.total ?? "?"))
              : test.imap.error}
          </span>
          <span className="flex items-center gap-2">
            {test.smtp.ok ? <Check className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            SMTP: {test.smtp.ok ? t("imap.test.smtpOk") : test.smtp.error}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={busy || !(form.host && form.user && (form.password || form.passwordSet))}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {t("imap.testBtn")}
        </button>
        <button
          onClick={handleSave}
          disabled={busy || !(form.user && (form.password || form.passwordSet))}
          className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {t("imap.save")}
        </button>
      </div>
    </div>
  );
}
