"use client";

import { Languages } from "lucide-react";
import { LOCALES, useI18n, type Locale } from "@/lib/i18n";

/**
 * 言語切替（日本語 / English / Français / 中文）。4言語あるためセグメントではなく
 * コンパクトな select。ラベルは各言語の自称表記でそのまま出す。
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="mt-1 flex items-center gap-1.5 px-0.5">
      <span className="shrink-0 text-[10px] text-fg-subtle">{t("lang.label")}</span>
      <div className="flex flex-1 items-center gap-1 rounded-lg border border-border px-1.5 py-1">
        <Languages className="size-3 shrink-0 text-fg-subtle" />
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          aria-label={t("lang.label")}
          className="w-full cursor-pointer bg-transparent text-[11px] text-fg outline-none"
        >
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code} className="bg-surface text-fg">
              {l.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
