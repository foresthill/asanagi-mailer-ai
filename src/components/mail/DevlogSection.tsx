"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, AlertCircle, ScrollText } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface DvView {
  baseUrl: string;
  projectKey: string;
  projectName: string;
  token: { set: boolean; last4?: string };
  configured: boolean;
}

interface DvProject {
  key: string;
  name: string;
}

/**
 * devlog 連携の接続設定。base URL + MCP トークン + 既定プロジェクトを保存する。
 * devlog は MCP 経由（Bearer dvlg_...）でしか外部から叩けないので、トークンは
 * devlog のプロジェクト設定で発行して貼り付ける。トークンは端末内のみ（マスク返却）。
 */
export function DevlogSection() {
  const { t } = useI18n();
  const [view, setView] = useState<DvView | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState(""); // blank = keep stored token
  const [projectKey, setProjectKey] = useState("");
  const [projects, setProjects] = useState<DvProject[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/devlog");
      const d = (await res.json()) as DvView;
      setView(d);
      setBaseUrl(d.baseUrl ?? "");
      setProjectKey(d.projectKey ?? "");
      setToken("");
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    // async loader — setState only after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function connect() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/devlog/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, token }),
      });
      const d = (await res.json()) as {
        ok: boolean;
        projects?: DvProject[];
        error?: string;
      };
      if (d.ok && d.projects) {
        setProjects(d.projects);
        setMsg({
          ok: true,
          text: t("dv.connect.ok").replace("{n}", String(d.projects.length)),
        });
        if (!projectKey && d.projects[0]) setProjectKey(d.projects[0].key);
      } else {
        setMsg({ ok: false, text: d.error ?? t("dv.connect.fail") });
      }
    } catch {
      setMsg({ ok: false, text: t("dv.connect.fail") });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const projectName =
        projects.find((p) => p.key === projectKey)?.name ??
        view?.projectName ??
        "";
      const payload: Record<string, string> = {
        baseUrl,
        projectKey,
        projectName,
      };
      if (token.trim()) payload.token = token.trim();
      const res = await fetch("/api/integrations/devlog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = (await res.json()) as DvView & { ok: boolean };
      setView(d);
      setToken("");
      setMsg({ ok: true, text: t("dv.saved") });
    } catch {
      setMsg({ ok: false, text: t("dv.connect.fail") });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    setMsg(null);
    try {
      await fetch("/api/integrations/devlog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "",
          baseUrl: "",
          projectKey: "",
          projectName: "",
        }),
      });
      setProjects([]);
      setProjectKey("");
      setBaseUrl("");
      await load();
      setMsg({ ok: true, text: t("dv.disconnected") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-t border-border pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <ScrollText className="size-4 text-accent" />
        {t("dv.title")}
        {view?.configured && (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
            {t("dv.connected")}
          </span>
        )}
      </h3>
      <p className="mt-1 text-xs text-fg-muted">{t("dv.intro")}</p>

      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">
            {t("dv.baseUrl")}
          </span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://devlog-mu.vercel.app"
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            {t("dv.token")}
            {view?.token.set && (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                {t("conn.keySet").replace("{last4}", view.token.last4 ?? "")}
              </span>
            )}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              view?.token.set ? t("conn.keyPlaceholder.change") : "dvlg_..."
            }
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          <span className="text-[11px] text-fg-subtle">
            {t("dv.token.note")}
          </span>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={connect}
            disabled={busy || (!baseUrl.trim() && !view?.configured)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("dv.connect.btn")}
          </button>
        </div>

        {(projects.length > 0 || view?.projectName) && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">
              {t("dv.project")}
            </span>
            {projects.length > 0 ? (
              <select
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}（{p.key}）
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                {view?.projectName}
              </span>
            )}
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
            disabled={saving || !baseUrl.trim() || !projectKey}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("dv.save")}
          </button>
          {view?.configured && (
            <button
              type="button"
              onClick={disconnect}
              disabled={saving}
              className="text-[11px] text-fg-subtle underline hover:text-high"
            >
              {t("dv.disconnect")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
