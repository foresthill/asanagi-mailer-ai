"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

type Theme = "system" | "light" | "dark";

const KEY = "asanagi:theme";

/** 好み(system/light/dark)を「具体値」へ解決して <html data-theme> に反映。
 *  system は OS を見て解決。data-theme を常に light|dark の具体値にすることで、
 *  token だけでなく dark: ユーティリティも追従する（globals.css の @custom-variant）。 */
function applyTheme(pref: Theme) {
  const el = document.documentElement;
  const dark =
    pref === "dark" ||
    (pref !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  el.dataset.theme = dark ? "dark" : "light";
}

/**
 * テーマ切替（システム / ライト / ダーク）。UI は「好み」を保持し、実際の見た目は
 * それを解決した data-theme（具体値）で決まる。初回描画は system 固定で SSR と
 * 一致させ、マウント後に保存値へ寄せる（適用自体は layout のインラインscriptが
 * 描画前に済ませている）。system の間は OS 変更に追従する。
 */
export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    let saved: Theme = "system";
    try {
      const v = localStorage.getItem(KEY);
      if (v === "light" || v === "dark" || v === "system") saved = v;
    } catch {
      // localStorage 不可（プライベート等）→ system のまま
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(saved);
    // system の間は OS のダーク切替に追従して data-theme を解決し直す。
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let cur: Theme = "system";
      try {
        const v = localStorage.getItem(KEY);
        if (v === "light" || v === "dark" || v === "system") cur = v;
      } catch {
        // noop
      }
      if (cur === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const choose = (t: Theme) => {
    setTheme(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // 保存できなくてもこのセッションでは反映する
    }
    applyTheme(t);
  };

  const opts: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "system", label: t("theme.system"), icon: Monitor },
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
  ];

  return (
    <div className="mt-1 flex items-center gap-1.5 px-0.5">
      <span className="shrink-0 text-[10px] text-fg-subtle">{t("theme.label")}</span>
      <div className="flex flex-1 rounded-lg border border-border p-0.5">
        {opts.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => choose(value)}
            aria-pressed={theme === value}
            title={label}
            className={cn(
              "flex flex-1 items-center justify-center rounded-md px-1.5 py-1 transition-colors",
              theme === value
                ? "bg-accent-soft text-accent"
                : "text-fg-subtle hover:text-fg",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
