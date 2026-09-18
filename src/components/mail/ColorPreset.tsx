"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

type Preset = "iris" | "asanagi" | "retro";

const KEY = "asanagi:preset";

// 各プリセットの代表色（スウォッチ表示用。実際の適用は globals.css のトークン）。
const SWATCH: Record<Preset, string> = {
  iris: "#6d5efc",
  asanagi: "#0891b2",
  retro: "#b25a17",
};

/** <html data-preset> に反映（iris は既定なので属性を外す）。 */
function applyPreset(p: Preset) {
  const el = document.documentElement;
  if (p === "iris") delete el.dataset.preset;
  else el.dataset.preset = p;
}

/**
 * テーマ色プリセット（アイリス＝標準の紫 / 朝凪＝エメラルドブルー / レトロ＝セピア）。
 * 初回は iris 固定で SSR 一致、マウント後に保存値へ（適用は layout のインライン
 * scriptが描画前に済ませている）。
 */
export function ColorPreset() {
  const { t } = useI18n();
  const [preset, setPreset] = useState<Preset>("iris");

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "asanagi" || v === "retro" || v === "iris") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPreset(v);
      }
    } catch {
      // localStorage 不可 → iris のまま
    }
  }, []);

  const choose = (p: Preset) => {
    setPreset(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      // 保存できなくてもこのセッションでは反映する
    }
    applyPreset(p);
  };

  const opts: { value: Preset; label: string; title: string }[] = [
    { value: "iris", label: t("preset.iris"), title: t("preset.iris.title") },
    { value: "asanagi", label: t("preset.asanagi"), title: t("preset.asanagi.title") },
    { value: "retro", label: t("preset.retro"), title: t("preset.retro.title") },
  ];

  return (
    <div className="mt-1 flex items-center gap-1.5 px-0.5">
      <span className="shrink-0 text-[10px] text-fg-subtle">{t("preset.label")}</span>
      <div className="flex flex-1 rounded-lg border border-border p-0.5">
        {opts.map(({ value, label, title }) => (
          <button
            key={value}
            onClick={() => choose(value)}
            aria-pressed={preset === value}
            title={title}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1 text-[10px] transition-colors",
              preset === value
                ? "bg-accent-soft font-medium text-accent"
                : "text-fg-subtle hover:text-fg",
            )}
          >
            <span
              className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10"
              style={{ background: SWATCH[value] }}
            />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
