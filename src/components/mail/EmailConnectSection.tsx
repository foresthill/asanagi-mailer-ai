"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { GmailConnectSection, type GmailView } from "./GmailConnectSection";
import { ImapConnectSection, type ImapView } from "./ImapConnectSection";

export interface EmailView {
  active: string; // what actually runs: gmail | imap | mock | error
  choice: "auto" | "gmail" | "imap" | "mock";
  gmail: GmailView;
  imap: ImapView;
}

const PROVIDER_LABEL: Record<string, string> = {
  gmail: "Gmail",
  imap: "IMAP/SMTP",
  mock: "モック（デモ受信箱）",
  error: "設定エラー",
};

const CHOICES: { value: EmailView["choice"]; label: string }[] = [
  { value: "auto", label: "自動（Gmail → IMAP → モック）" },
  { value: "gmail", label: "Gmail" },
  { value: "imap", label: "IMAP/SMTP（会社メール等）" },
  { value: "mock", label: "モック（デモ）" },
];

/**
 * Email account settings: backend picker + Gmail connect + IMAP connect.
 * Fetches the masked settings view once and shares it with the children.
 */
export function EmailConnectSection() {
  const [view, setView] = useState<EmailView | null>(null);
  const [switching, setSwitching] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings/email");
    setView((await res.json()) as EmailView);
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
    return (
      <div className="grid place-items-center py-6 text-fg-muted">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Mail className="size-4 text-accent" />
        <h3 className="text-xs font-semibold">メールアカウント</h3>
        <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-fg-subtle">
          現在: {PROVIDER_LABEL[view.active] ?? view.active}
        </span>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">使用するバックエンド</span>
        <select
          value={view.choice}
          disabled={switching}
          onChange={(e) => changeChoice(e.target.value)}
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
        >
          {CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <GmailConnectSection gmail={view.gmail} onRefresh={refresh} />

      <div className="border-t border-border pt-4">
        <ImapConnectSection imap={view.imap} onRefresh={refresh} />
      </div>
    </div>
  );
}
