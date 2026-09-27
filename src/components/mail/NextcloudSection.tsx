"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, AlertCircle, CalendarDays } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface NcView {
  baseUrl: string;
  username: string;
  calendarUrl: string;
  calendarName: string;
  appPassword: { set: boolean; last4?: string };
  configured: boolean;
}

interface NcCalendar {
  url: string;
  name: string;
}

/**
 * Nextcloud 連携の接続設定（CalDAV）。base URL + ユーザー名 + アプリパスワード +
 * 対象カレンダーを保存する。「接続」でカレンダー一覧を取得して選ばせる。
 * アプリパスワードは端末内のみ（マスク返却）。
 */
export function NextcloudSection() {
  const { t } = useI18n();
  const [view, setView] = useState<NcView | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState(""); // blank = keep stored
  const [calendarUrl, setCalendarUrl] = useState("");
  const [calendars, setCalendars] = useState<NcCalendar[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/nextcloud");
      const d = (await res.json()) as NcView;
      setView(d);
      setBaseUrl(d.baseUrl ?? "");
      setUsername(d.username ?? "");
      setCalendarUrl(d.calendarUrl ?? "");
      setAppPassword("");
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
      const res = await fetch("/api/integrations/nextcloud/calendars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, username, appPassword }),
      });
      const d = (await res.json()) as {
        ok: boolean;
        calendars?: NcCalendar[];
        error?: string;
      };
      if (d.ok && d.calendars) {
        setCalendars(d.calendars);
        setMsg({
          ok: true,
          text: t("nc.connect.ok").replace("{n}", String(d.calendars.length)),
        });
        if (!calendarUrl && d.calendars[0]) setCalendarUrl(d.calendars[0].url);
      } else {
        setMsg({ ok: false, text: d.error ?? t("nc.connect.fail") });
      }
    } catch {
      setMsg({ ok: false, text: t("nc.connect.fail") });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const calendarName =
        calendars.find((c) => c.url === calendarUrl)?.name ??
        view?.calendarName ??
        "";
      const payload: Record<string, string> = {
        baseUrl,
        username,
        calendarUrl,
        calendarName,
      };
      if (appPassword.trim()) payload.appPassword = appPassword.trim();
      const res = await fetch("/api/integrations/nextcloud", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = (await res.json()) as NcView & { ok: boolean };
      setView(d);
      setAppPassword("");
      setMsg({ ok: true, text: t("nc.saved") });
    } catch {
      setMsg({ ok: false, text: t("nc.connect.fail") });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    setMsg(null);
    try {
      await fetch("/api/integrations/nextcloud", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appPassword: "",
          baseUrl: "",
          username: "",
          calendarUrl: "",
          calendarName: "",
        }),
      });
      setCalendars([]);
      setCalendarUrl("");
      setBaseUrl("");
      setUsername("");
      await load();
      setMsg({ ok: true, text: t("nc.disconnected") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-t border-border pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <CalendarDays className="size-4 text-accent" />
        {t("nc.title")}
        {view?.configured && (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
            {t("nc.connected")}
          </span>
        )}
      </h3>
      <p className="mt-1 text-xs text-fg-muted">{t("nc.intro")}</p>

      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">
            {t("nc.baseUrl")}
          </span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://cloud.example.com"
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">
            {t("nc.username")}
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            placeholder="user"
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            {t("nc.appPassword")}
            {view?.appPassword.set && (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                {t("conn.keySet").replace(
                  "{last4}",
                  view.appPassword.last4 ?? "",
                )}
              </span>
            )}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder={
              view?.appPassword.set
                ? t("conn.keyPlaceholder.change")
                : "xxxxx-xxxxx-xxxxx"
            }
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          <span className="text-[11px] text-fg-subtle">
            {t("nc.appPassword.note")}
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
            {t("nc.connect.btn")}
          </button>
        </div>

        {(calendars.length > 0 || view?.calendarName) && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">
              {t("nc.calendar")}
            </span>
            {calendars.length > 0 ? (
              <select
                value={calendarUrl}
                onChange={(e) => setCalendarUrl(e.target.value)}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {calendars.map((c) => (
                  <option key={c.url} value={c.url}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                {view?.calendarName}
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
            disabled={
              saving || !baseUrl.trim() || !username.trim() || !calendarUrl
            }
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("nc.save")}
          </button>
          {view?.configured && (
            <button
              type="button"
              onClick={disconnect}
              disabled={saving}
              className="text-[11px] text-fg-subtle underline hover:text-high"
            >
              {t("nc.disconnect")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
