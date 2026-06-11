"use client";

import { useEffect, useState } from "react";
import { Loader2, Unplug } from "lucide-react";

export interface GmailView {
  clientIdSet: boolean;
  clientSecretSet: boolean;
  connected: boolean;
  address?: string;
}

/**
 * Gmail account connect (BYO OAuth client). Save your own Google Cloud OAuth
 * client id/secret once, then run the consent flow; the refresh token is
 * stored locally (.data). View state lives in EmailConnectSection.
 */
export function GmailConnectSection({
  gmail: g,
  onRefresh,
}: {
  gmail: GmailView;
  onRefresh: () => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- origin is browser-only
    setOrigin(window.location.origin);
  }, []);

  async function saveAndAuth() {
    setBusy(true);
    try {
      await fetch("/api/settings/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gmail: {
            ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
            ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
          },
        }),
      });
      // Full-page navigation into the Google consent flow.
      window.location.href = "/api/auth/google";
    } catch {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/settings/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disconnect: "gmail" }),
      });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  const canAuth = (g.clientIdSet || clientId.trim()) && (g.clientSecretSet || clientSecret.trim());

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-[11px] font-semibold text-fg-muted">Gmail（OAuth）</h4>

      {g.connected ? (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span className="flex-1">接続済み{g.address ? `: ${g.address}` : ""}</span>
          <button
            onClick={disconnect}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-fg-muted hover:text-high disabled:opacity-50"
          >
            <Unplug className="size-3" />
            切断
          </button>
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">
              OAuth クライアント ID
              {g.clientIdSet && (
                <span className="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                  設定済み
                </span>
              )}
            </span>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={g.clientIdSet ? "変更する場合のみ入力" : "....apps.googleusercontent.com"}
              autoComplete="off"
              className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">
              OAuth クライアント シークレット
              {g.clientSecretSet && (
                <span className="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                  設定済み
                </span>
              )}
            </span>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={g.clientSecretSet ? "変更する場合のみ入力" : "GOCSPX-..."}
              autoComplete="off"
              className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
            />
          </label>

          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-fg-subtle">
            Google Cloud で OAuth クライアント（Webアプリ）を作成し、リダイレクトURIに
            <code className="mx-1 rounded bg-bg px-1 py-0.5 font-mono">
              {origin}/api/auth/google/callback
            </code>
            を登録してください（手順は README）。権限は gmail.modify のみ＝完全削除は不可。
            トークンはこの端末のローカル（.data）にのみ保存されます。
          </p>

          <button
            onClick={saveAndAuth}
            disabled={busy || !canAuth}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Google で認証して接続
          </button>
        </>
      )}
    </div>
  );
}
