"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, AlertCircle, Unplug } from "lucide-react";

export interface ImapView {
  host: string;
  port: string;
  secure: string;
  user: string;
  archiveFolder: string;
  trashFolder: string;
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
      host: form.host,
      port: form.port,
      user: form.user,
      archiveFolder: form.archiveFolder,
      trashFolder: form.trashFolder,
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
      setTest({ ok: false, imap: { ok: false, error: "テスト実行に失敗" }, smtp: { ok: false } });
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
        <h4 className="text-[11px] font-semibold text-fg-muted">IMAP/SMTP（会社メール等）</h4>
        {configured && (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
            設定済み: {imap.user}@{imap.host}
          </span>
        )}
        {imap.envConfigured && !configured && (
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">
            env設定あり
          </span>
        )}
        {configured && (
          <button
            onClick={disconnect}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-fg-muted hover:text-high disabled:opacity-50"
          >
            <Unplug className="size-3" />
            クリア
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="col-span-2 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">IMAP ホスト</span>
          <input value={form.host} onChange={set("host")} placeholder="imap.example.com" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">ポート</span>
          <input value={form.port} onChange={set("port")} placeholder="993" className={inputCls} />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">ユーザー（メールアドレス）</span>
        <input value={form.user} onChange={set("user")} placeholder="you@example.com" autoComplete="off" className={inputCls} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          パスワード
          {imap.passwordSet && (
            <span className="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
              設定済み
            </span>
          )}
        </span>
        <input
          type="password"
          value={form.password}
          onChange={set("password")}
          placeholder={imap.passwordSet ? "変更する場合のみ入力" : "アプリ用パスワード推奨"}
          autoComplete="off"
          className={inputCls}
        />
      </label>

      <details className="rounded-lg bg-surface-2 px-3 py-2">
        <summary className="cursor-pointer text-[11px] text-fg-muted">
          高度な設定（SMTP・フォルダ名 — 空欄はIMAPの値/既定値を使用）
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">SMTP ホスト</span>
              <input value={form.smtpHost} onChange={set("smtpHost")} placeholder={form.host || "smtp.example.com"} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">SMTP ポート</span>
              <input value={form.smtpPort} onChange={set("smtpPort")} placeholder="465" className={inputCls} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">SMTP ユーザー</span>
              <input value={form.smtpUser} onChange={set("smtpUser")} placeholder="(IMAPと同じ)" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">
                SMTP パスワード{imap.smtpPasswordSet ? "（設定済み）" : ""}
              </span>
              <input type="password" value={form.smtpPassword} onChange={set("smtpPassword")} placeholder="(IMAPと同じ)" autoComplete="off" className={inputCls} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">送信元 (From)</span>
              <input value={form.smtpFrom} onChange={set("smtpFrom")} placeholder="(ユーザーと同じ)" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">アーカイブフォルダ</span>
              <input value={form.archiveFolder} onChange={set("archiveFolder")} placeholder="Archive" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">ゴミ箱フォルダ</span>
              <input value={form.trashFolder} onChange={set("trashFolder")} placeholder="Trash" className={inputCls} />
            </label>
          </div>
        </div>
      </details>

      {test && (
        <div
          className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-xs ${
            test.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-high-soft text-high"
          }`}
        >
          <span className="flex items-center gap-2">
            {test.imap.ok ? <Check className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            IMAP: {test.imap.ok ? `OK（INBOX ${test.imap.total ?? "?"}件）` : test.imap.error}
          </span>
          <span className="flex items-center gap-2">
            {test.smtp.ok ? <Check className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            SMTP: {test.smtp.ok ? "OK" : test.smtp.error}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={busy || !(form.host && form.user && (form.password || imap.passwordSet))}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          接続テスト
        </button>
        <button
          onClick={handleSave}
          disabled={busy}
          className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          保存
        </button>
      </div>
    </div>
  );
}
