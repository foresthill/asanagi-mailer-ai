"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Blocks,
  FolderKanban,
  ScrollText,
  CalendarDays,
  CalendarClock,
  Check,
  Settings2,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface IntegStatus {
  configured: boolean;
  baseUrl?: string;
  projectName?: string;
  calendarName?: string;
}

interface IntegDef {
  id: string;
  name: string;
  icon: LucideIcon;
  endpoint: string;
  /** i18n key for the one-line "what it does". */
  descKey: string;
}

// Only REAL, working integrations are listed (no placeholder cards — 偽機能禁止).
const INTEGRATIONS: IntegDef[] = [
  {
    id: "openproject",
    name: "OpenProject",
    icon: FolderKanban,
    endpoint: "/api/integrations/openproject",
    descKey: "integrations.desc.task",
  },
  {
    id: "devlog",
    name: "devlog",
    icon: ScrollText,
    endpoint: "/api/integrations/devlog",
    descKey: "integrations.desc.task",
  },
  {
    id: "nextcloud",
    name: "Nextcloud",
    icon: CalendarDays,
    endpoint: "/api/integrations/nextcloud",
    descKey: "integrations.desc.calendar",
  },
  {
    id: "google",
    name: "Google カレンダー",
    icon: CalendarClock,
    endpoint: "/api/calendar/status",
    descKey: "integrations.desc.calendar",
  },
];

/**
 * 連携（インテグレーション）一覧。今つながる相手と接続状況を一望し、設定へ飛ぶ。
 * ステータスは各連携の GET から取得する実データ（プレースホルダは並べない）。
 */
export function IntegrationsView({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Record<string, IntegStatus>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await Promise.all(
        INTEGRATIONS.map(async (i) => {
          try {
            const res = await fetch(i.endpoint);
            return [i.id, (await res.json()) as IntegStatus] as const;
          } catch {
            return [i.id, { configured: false }] as const;
          }
        }),
      );
      setStatus(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-bg">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-6 py-3.5">
        <Blocks className="size-4 text-accent" />
        <h1 className="text-sm font-semibold">{t("nav.integrations")}</h1>
        <button
          onClick={load}
          title={t("integrations.refresh")}
          className="ml-auto grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
      </header>
      <p className="border-b border-border bg-surface-2 px-6 py-2 text-[11px] text-fg-muted">
        {t("integrations.intro")}
      </p>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
          {INTEGRATIONS.map((i) => {
            const s = status[i.id];
            const connected = !!s?.configured;
            const Icon = i.icon;
            return (
              <div
                key={i.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <Icon className="size-5 shrink-0 text-accent" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {i.name}
                    {connected ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                        <Check className="size-2.5" />
                        {t("integrations.connected")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">
                        {t("integrations.notConnected")}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[11px] text-fg-subtle">
                    {(() => {
                      const detail = s?.projectName || s?.calendarName;
                      return connected && detail
                        ? `${t(i.descKey)} · ${detail}`
                        : t(i.descKey);
                    })()}
                  </span>
                </div>
                <button
                  onClick={onOpenSettings}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent"
                >
                  <Settings2 className="size-3.5" />
                  {connected
                    ? t("integrations.manage")
                    : t("integrations.connect")}
                </button>
              </div>
            );
          })}

          <p className="mt-2 text-[11px] text-fg-subtle">
            {t("integrations.planned")}
          </p>
        </div>
      </div>
    </div>
  );
}
