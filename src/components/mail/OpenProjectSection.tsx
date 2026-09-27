"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, AlertCircle, FolderKanban } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface OpView {
  baseUrl: string;
  projectId: string;
  projectName: string;
  apiKey: { set: boolean; last4?: string };
  configured: boolean;
}

interface OpProject {
  id: number;
  name: string;
  identifier: string;
}

/**
 * OpenProject 連携の接続設定。base URL + API キー + 既定プロジェクトを保存する。
 * 「接続」でプロジェクト一覧を取得して選ばせ、その1つを常に送り先にする。
 * APIキーは端末内のみ（マスク返却）。local-first。
 */
export function OpenProjectSection() {
  const { t } = useI18n();
  const [view, setView] = useState<OpView | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState(""); // blank = keep stored key
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<OpProject[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/openproject");
      const d = (await res.json()) as OpView;
      setView(d);
      setBaseUrl(d.baseUrl ?? "");
      setProjectId(d.projectId ?? "");
      setApiKey("");
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    // async loader — setState only after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Fetch the project list to populate the picker (verifies the connection too).
  async function connect() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/openproject/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey }),
      });
      const d = (await res.json()) as {
        ok: boolean;
        projects?: OpProject[];
        error?: string;
      };
      if (d.ok && d.projects) {
        setProjects(d.projects);
        setMsg({
          ok: true,
          text: t("op.connect.ok").replace("{n}", String(d.projects.length)),
        });
        if (!projectId && d.projects[0]) setProjectId(String(d.projects[0].id));
      } else {
        setMsg({ ok: false, text: d.error ?? t("op.connect.fail") });
      }
    } catch {
      setMsg({ ok: false, text: t("op.connect.fail") });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const projectName =
        projects.find((p) => String(p.id) === projectId)?.name ??
        view?.projectName ??
        "";
      const payload: Record<string, string> = {
        baseUrl,
        projectId,
        projectName,
      };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const res = await fetch("/api/integrations/openproject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = (await res.json()) as OpView & { ok: boolean };
      setView(d);
      setApiKey("");
      setMsg({ ok: true, text: t("op.saved") });
    } catch {
      setMsg({ ok: false, text: t("op.connect.fail") });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    setMsg(null);
    try {
      await fetch("/api/integrations/openproject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: "",
          baseUrl: "",
          projectId: "",
          projectName: "",
        }),
      });
      setProjects([]);
      setProjectId("");
      setBaseUrl("");
      await load();
      setMsg({ ok: true, text: t("op.disconnected") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-t border-border pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <FolderKanban className="size-4 text-accent" />
        {t("op.title")}
        {view?.configured && (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
            {t("op.connected")}
          </span>
        )}
      </h3>
      <p className="mt-1 text-xs text-fg-muted">{t("op.intro")}</p>

      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">
            {t("op.baseUrl")}
          </span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://openproject.example.com"
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            {t("op.apiKey")}
            {view?.apiKey.set && (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                {t("conn.keySet").replace("{last4}", view.apiKey.last4 ?? "")}
              </span>
            )}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              view?.apiKey.set
                ? t("conn.keyPlaceholder.change")
                : "OpenProject の API トークン"
            }
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          <span className="text-[11px] text-fg-subtle">
            {t("op.apiKey.note")}
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
            {t("op.connect.btn")}
          </button>
        </div>

        {(projects.length > 0 || view?.projectName) && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">
              {t("op.project")}
            </span>
            {projects.length > 0 ? (
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
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
            disabled={saving || !baseUrl.trim() || !projectId}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("op.save")}
          </button>
          {view?.configured && (
            <button
              type="button"
              onClick={disconnect}
              disabled={saving}
              className="text-[11px] text-fg-subtle underline hover:text-high"
            >
              {t("op.disconnect")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
