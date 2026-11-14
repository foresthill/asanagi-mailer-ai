"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, AlertCircle, BookText } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface ObView {
  vaultPath: string;
  folder: string;
  pathExists: boolean;
  configured: boolean;
}

/**
 * Obsidian 連携の接続設定（ローカル vault への Markdown 書き出し）。vault の絶対パスと
 * 保存先サブフォルダを保存するだけ。資格情報は無い（ネットワーク不要・端末内で完結）。
 * パスは端末内のみに保存される。
 */
export function ObsidianSection() {
  const { t } = useI18n();
  const [view, setView] = useState<ObView | null>(null);
  const [vaultPath, setVaultPath] = useState("");
  const [folder, setFolder] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/obsidian");
      const d = (await res.json()) as ObView;
      setView(d);
      setVaultPath(d.vaultPath ?? "");
      setFolder(d.folder ?? "");
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
      const res = await fetch("/api/integrations/obsidian", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultPath, folder }),
      });
      const d = (await res.json()) as ObView & { ok: boolean };
      setView(d);
      setVaultPath(d.vaultPath ?? "");
      setFolder(d.folder ?? "");
      // パスが実在しなければ保存はできても「見つからない」と伝える（接続扱いにしない）。
      setMsg(
        d.pathExists
          ? { ok: true, text: t("ob.saved") }
          : { ok: false, text: t("ob.notFound") },
      );
    } catch {
      setMsg({ ok: false, text: t("ob.notFound") });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    setMsg(null);
    try {
      await fetch("/api/integrations/obsidian", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultPath: "", folder: "" }),
      });
      setVaultPath("");
      setFolder("");
      await load();
      setMsg({ ok: true, text: t("ob.disconnected") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-t border-border pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <BookText className="size-4 text-accent" />
        {t("ob.title")}
        {view?.configured && (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
            {t("ob.connected")}
          </span>
        )}
      </h3>
      <p className="mt-1 text-xs text-fg-muted">{t("ob.intro")}</p>

      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">
            {t("ob.vaultPath")}
          </span>
          <input
            value={vaultPath}
            onChange={(e) => setVaultPath(e.target.value)}
            placeholder="/Users/you/Documents/MyVault"
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          <span className="text-[11px] text-fg-subtle">
            {t("ob.vaultPath.note")}
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">
            {t("ob.folder")}
          </span>
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="Asanagi"
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          <span className="text-[11px] text-fg-subtle">
            {t("ob.folder.note")}
          </span>
        </label>

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
            disabled={saving || !vaultPath.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("ob.save")}
          </button>
          {view?.configured && (
            <button
              type="button"
              onClick={disconnect}
              disabled={saving}
              className="text-[11px] text-fg-subtle underline hover:text-high"
            >
              {t("ob.disconnect")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
