"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "system" | "light" | "dark";

const KEY = "asanagi:theme";

/** <html data-theme> に反映（system は属性を外して OS 追従）。color-scheme も
 *  トークン側で切り替わるので、ここは属性の付け外しだけでよい。 */
function applyTheme(theme: Theme) {
  const el = document.documentElement;
  if (theme === "system") delete el.dataset.theme;
  else el.dataset.theme = theme;
}

/**
 * テーマ切替（システム / ライト / ダーク）。初回描画は system 固定で SSR と一致
 * させ、マウント後に保存値へ寄せる（実際の見た目は layout のインラインscriptが
 * 描画前に適用済みなので、ここはUIの選択状態を合わせるだけ）。
 */
export function ThemeToggle() {
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
    { value: "system", label: "システム（OSに合わせる）", icon: Monitor },
    { value: "light", label: "ライト", icon: Sun },
    { value: "dark", label: "ダーク", icon: Moon },
  ];

  return (
    <div className="mt-1 flex items-center gap-1.5 px-0.5">
      <span className="shrink-0 text-[10px] text-fg-subtle">テーマ</span>
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
