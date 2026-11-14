"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, AlertCircle, Users, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface TrView {
  filePath: string;
  fileExists: boolean;
  rules: string[];
  ruleCount: number;
  configured: boolean;
}

/**
 * チーム共有ルール（集合的無意識 / docs/10 Phase 2・案A）の設定。共有 team-rules.json の
 * パスを保存し、今チームで共有されているルール行を一覧する。返信生成時は「個人ルール >
 * チームルール」で合成される（本文・PII は共有しない）。書き戻しは opt-in の「チームに提案」。
 */
export function TeamRulesSection() {
  const { t } = useI18n();
  const [view, setView] = useState<TrView | null>(null);
  const [filePath, setFilePath] = useState("");
  const [proposal, setProposal] = useState("");
  const [saving, setSaving] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/team-rules");
      const d = (await res.json()) as TrView;
      setView(d);
      setFilePath(d.filePath ?? "");
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    // async loader — setState only after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/team-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      const d = (await res.json()) as TrView & { ok: boolean };
      setView(d);
      setFilePath(d.filePath ?? "");
      setMsg({ ok: true, text: t("tr.saved") });
    } catch {
      setMsg({ ok: false, text: t("tr.fail") });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    setMsg(null);
    try {
      await fetch("/api/integrations/team-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filePath: "" }),
      });
      setFilePath("");
      await load();
      setMsg({ ok: true, text: t("tr.disconnected") });
    } finally {
      setSaving(false);
    }
  }

  async function propose() {
    const rule = proposal.trim();
    if (!rule) return;
    setProposing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/team-rules/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rule }),
      });
      const d = (await res.json()) as {
        ok: boolean;
        rules?: string[];
        error?: string;
      };
      if (d.ok) {
        setProposal("");
        setView((v) =>
          v
            ? { ...v, rules: d.rules ?? v.rules, ruleCount: (d.rules ?? v.rules).length }
            : v,
        );
        setMsg({ ok: true, text: t("tr.proposed") });
      } else {
        setMsg({ ok: false, text: d.error ?? t("tr.fail") });
      }
    } catch {
      setMsg({ ok: false, text: t("tr.fail") });
    } finally {
      setProposing(false);
    }
  }

  return (
    <section className="border-t border-border pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Users className="size-4 text-accent" />
        {t("tr.title")}
        {view?.configured && (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
            {t("tr.connected")}
          </span>
        )}
      </h3>
      <p className="mt-1 text-xs text-fg-muted">{t("tr.intro")}</p>

      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">
            {t("tr.filePath")}
          </span>
          <input
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="/Users/you/Nextcloud/team/team-rules.json"
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          <span className="text-[11px] text-fg-subtle">
            {t("tr.filePath.note")}
          </span>
        </label>

        {/* 今チームで共有されているルール（読み込みマージされる既定値）。 */}
        {view?.configured && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">
              {t("tr.current").replace("{n}", String(view.ruleCount))}
            </span>
            {view.rules.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2 px-3 py-2">
                {view.rules.map((r, i) => (
                  <li key={i} className="text-xs text-fg">
                    ・{r}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-subtle">
                {view.fileExists ? t("tr.empty") : t("tr.noFileYet")}
              </span>
            )}
          </div>
        )}

        {/* opt-in の「チームに提案」。抽象ルール行だけを1行、プレビュー＝自分で確認して追記。 */}
        {view?.configured && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">
              {t("tr.propose")}
            </span>
            <textarea
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
              rows={2}
              placeholder={t("tr.propose.placeholder")}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <span className="text-[11px] text-fg-subtle">
              {t("tr.propose.note")}
            </span>
            <div>
              <button
                type="button"
                onClick={propose}
                disabled={proposing || !proposal.trim()}
                className="mt-1 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2 disabled:opacity-50"
              >
                {proposing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                {t("tr.propose.btn")}
              </button>
            </div>
          </label>
        )}

        {msg && (
          <div
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
              msg.ok
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-high-soft text-high"
            }`}
          >
            {msg.ok ? (
              <Check className="size-4" />
            ) : (
              <AlertCircle className="size-4" />
            )}
            <span className="break-all">{msg.text}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving || !filePath.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("tr.save")}
          </button>
          {view?.configured && (
            <button
              type="button"
              onClick={disconnect}
              disabled={saving}
              className="text-[11px] text-fg-subtle underline hover:text-high"
            >
              {t("tr.disconnect")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
