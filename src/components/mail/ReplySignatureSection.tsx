"use client";

import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";

type Acct = { key: string; label: string; address?: string };

/**
 * Per-account reply identity/signature (AI返信での名乗り). Lets you say who you
 * are when replying from each account, so the draft is written in your voice
 * even when the thread history is signed by someone else (shared/CC'd mailbox).
 */
export function ReplySignatureSection() {
  const [accounts, setAccounts] = useState<Acct[]>([]);
  const [sigs, setSigs] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/ai/signature")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setAccounts(d.accounts ?? []);
        setSigs(d.signatures ?? {});
      })
      .catch(() => {
        /* best-effort — section just stays empty */
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save(account: string, text: string) {
    try {
      await fetch("/api/ai/signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account, text }),
      });
      setSaved(account);
      setTimeout(() => setSaved((s) => (s === account ? null : s)), 1500);
    } catch {
      /* ignore — will retry on next blur */
    }
  }

  if (!accounts.length) return null;

  return (
    <section className="border-t border-border pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <PenLine className="size-4 text-accent" />
        AI返信での名乗り（署名）
      </h3>
      <p className="mt-1 text-xs text-fg-muted">
        アカウントごとに「返信を誰として書くか」を設定します。スレッドの履歴が別の人の名義でも、この名乗りで下書きされます。
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {accounts.map((a) => (
          <label key={a.key} className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">
              {a.label}
              {a.address ? `（${a.address}）` : ""}
              {saved === a.key && <span className="ml-1 text-accent">✓ 保存しました</span>}
            </span>
            <textarea
              defaultValue={sigs[a.key] ?? ""}
              onBlur={(e) => save(a.key, e.target.value)}
              placeholder="例: イグレックプラス 森岡（実証フィールド担当）"
              rows={2}
              className="resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
        ))}
      </div>
    </section>
  );
}
