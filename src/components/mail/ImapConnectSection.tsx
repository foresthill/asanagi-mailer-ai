"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, AlertCircle, Unplug } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface ImapView {
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
  passwordSet: boolean;
  smtpPasswordSet: boolean;
  envConfigured: boolean;
}

interface TestResult {
  ok: boolean;
  imap: { ok: boolean; total?: number; error?: string };
  smtp: { ok: boolean; error?: string };
}

const inputCls =
  "rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent";

/**
 * Generic IMAP/SMTP connect (e.g. company mail). Credentials are saved
 * locally (.data); blank SMTP fields fall back to the IMAP values.
 * View state lives in EmailConnectSection.
 */
export function ImapConnectSection({
  imap,
  onRefresh,
}: {
  imap: ImapView;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ ...imap, password: "", smtpPassword: "" });
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => {
    // Refresh editable fields when the server view changes (e.g. after save).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync form with server view
    setForm((f) => ({ ...f, ...imap, password: "", smtpPassword: "" }));
  }, [imap]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const configured = Boolean(imap.host && imap.user && imap.passwordSet);

  async function save(): Promise<void> {
    const body: Record<string, string> = {
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
    };
    // Only send passwords the user actually typed (blank would clear them).
    if (form.password.trim()) body.password = form.password.trim();
    if (form.smtpPassword.trim()) body.smtpPassword = form.smtpPassword.trim();
    await fetch("/api/settings/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imap: body }),
    });
    await onRefresh();
  }

  async function handleSave() {
    setBusy(true);
    setTest(null);
    try {
      await save();
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setTest(null);
    try {
      await save();
      const res = await fetch("/api/settings/email/test", { method: "POST" });
      setTest((await res.json()) as TestResult);
    } catch {
      setTest({
        ok: false,
        imap: { ok: false, error: t("imap.test.failed") },
        smtp: { ok: false },
      });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setTest(null);
    try {
      await fetch("/api/settings/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disconnect: "imap" }),
      });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h4 className="text-[11px] font-semibold text-fg-muted">
          {t("imap.title")}
        </h4>
        {configured && (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
            {t("imap.configured")
              .replace("{user}", imap.user)
              .replace("{host}", imap.host)}
          </span>
        )}
        {imap.envConfigured && !configured && (
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">
            {t("imap.envConfigured")}
          </span>
        )}
        {configured && (
          <button
            onClick={disconnect}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-fg-muted hover:text-high disabled:opacity-50"
          >
            <Unplug className="size-3" />
            {t("imap.clear")}
          </button>
        )}
      </div>

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
        <span className="text-[11px] text-fg-subtle">
          {t("imap.fromName.note")}
        </span>
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="col-span-2 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            {t("imap.host")}
          </span>
          <input
            value={form.host}
            onChange={set("host")}
            placeholder="imap.example.com"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            {t("imap.port")}
          </span>
          <input
            value={form.port}
            onChange={set("port")}
            placeholder="993"
            className={inputCls}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {t("imap.user")}
        </span>
        <input
          value={form.user}
          onChange={set("user")}
          placeholder="you@example.com"
          autoComplete="off"
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {t("imap.password")}
          {imap.passwordSet && (
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
            imap.passwordSet
              ? t("imap.placeholder.changeOnly")
              : t("imap.placeholder.appPassword")
          }
          autoComplete="off"
          className={inputCls}
        />
      </label>

      <details className="rounded-lg bg-surface-2 px-3 py-2">
        <summary className="cursor-pointer text-[11px] text-fg-muted">
          {t("imap.advanced")}
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">
                {t("imap.smtpHost")}
              </span>
              <input
                value={form.smtpHost}
                onChange={set("smtpHost")}
                placeholder={form.host || "smtp.example.com"}
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
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">
                {t("imap.smtpPassword")}
                {imap.smtpPasswordSet ? t("imap.setParen") : ""}
              </span>
              <input
                type="password"
                value={form.smtpPassword}
                onChange={set("smtpPassword")}
                placeholder={t("imap.placeholder.sameAsImap")}
                autoComplete="off"
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
                className={inputCls}
              />
            </label>
          </div>
        </div>
      </details>

      {test && (
        <div
          className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-xs ${
            test.ok
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-high-soft text-high"
          }`}
        >
          <span className="flex items-center gap-2">
            {test.imap.ok ? (
              <Check className="size-3.5" />
            ) : (
              <AlertCircle className="size-3.5" />
            )}
            IMAP:{" "}
            {test.imap.ok
              ? t("imap.test.imapOk").replace(
                  "{n}",
                  String(test.imap.total ?? "?"),
                )
              : test.imap.error}
          </span>
          <span className="flex items-center gap-2">
            {test.smtp.ok ? (
              <Check className="size-3.5" />
            ) : (
              <AlertCircle className="size-3.5" />
            )}
            SMTP: {test.smtp.ok ? t("imap.test.smtpOk") : test.smtp.error}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={
            busy ||
            !(form.host && form.user && (form.password || imap.passwordSet))
          }
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {t("imap.testBtn")}
        </button>
        <button
          onClick={handleSave}
          disabled={busy}
          className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {t("imap.save")}
        </button>
      </div>
    </div>
  );
}
