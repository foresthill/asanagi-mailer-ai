"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { Email } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { displayName } from "./helpers";
import { JevCompare } from "./JevCompare";

/**
 * Jev プレイグラウンド（比較・sandbox）: 受信箱から1通選び、現行の LLM 判定
 * （Claude 等）と Jev（System One）を同時に走らせて比較する。接続設定内の
 * 管理者向け評価ツール。実際の「この1通を判定」は本文の「判定」タブからも
 * 同じ比較ができる（どちらも共有の JevCompare を使う）。
 */
export function JevPlayground() {
  const { t } = useI18n();
  const [emails, setEmails] = useState<Email[]>([]);
  const [pick, setPick] = useState<string>("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/emails");
        const d = (await r.json()) as { emails?: Email[] };
        if (!active) return;
        const list = (d.emails ?? []).slice(0, 15);
        setEmails(list);
        if (list[0]) setPick(list[0].id);
      } catch {
        /* list is best-effort; the picker just stays empty */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const picked = emails.find((e) => e.id === pick) ?? null;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-bg px-3 py-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-fg">
        <Sparkles className="size-3.5 text-accent" />
        {t("play.title")}
      </div>
      <p className="text-[11px] leading-relaxed text-fg-subtle">
        {t("play.desc")}
      </p>

      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="min-w-0 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
      >
        {emails.length === 0 && <option value="">{t("play.noMail")}</option>}
        {emails.map((e) => (
          <option key={e.id} value={e.id}>
            {displayName(e.from)}｜{e.subject || "(件名なし)"}
          </option>
        ))}
      </select>

      <JevCompare key={picked?.id ?? "none"} email={picked} />
    </div>
  );
}
