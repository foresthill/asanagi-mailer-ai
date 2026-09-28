"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 宛先が複数ありうるアクション1件分（カレンダー登録・起票 など）。 */
export type MenuTarget = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** active（登録済み/紐付け済み）のときに使うアイコン（例: CalendarCheck）。省略時は icon。 */
  activeIcon?: LucideIcon;
  /** 現在の対象が既に登録済み/紐付け済みか。色分け・activeIcon の切替に使う。 */
  active: boolean;
  onSelect: () => void;
};

/** アイコンをプロップ経由で描く安定コンポーネント（render 中のコンポーネント生成を避ける）。 */
function Glyph({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <Icon className={className} />;
}

/**
 * 「1件=直接実行／複数=1ボタン＋ドロップダウンで宛先選択」の共通ボタン。
 * カレンダー登録（calendarTargets）や起票（issueTargets）のように、宛先が複数ありうる
 * アクションで TodoView / EmailReader 双方から使う。表示条件（例: 期限があるときだけ）や
 * 宛先配列の組み立ては呼び出し側の責務。開閉状態はこのコンポーネント内に閉じる
 * （オーバーレイで外側クリック時に閉じる。挙動は従来の個別実装と同じ）。
 */
export function TargetMenu({
  targets,
  variant,
  summaryIcon,
  summaryActiveIcon,
  summaryLabel,
}: {
  targets: MenuTarget[];
  /** row = TodoView 行内（小・rounded-md）／ toolbar = EmailReader ツールバー（IconBtn 相当）。 */
  variant: "row" | "toolbar";
  /** 複数宛先時のまとめボタンのアイコン（例: Send / CalendarPlus）。 */
  summaryIcon: LucideIcon;
  /** 複数宛先で1件以上 active のときのまとめアイコン（例: CalendarCheck）。省略時は summaryIcon。 */
  summaryActiveIcon?: LucideIcon;
  /** まとめボタンのツールチップ。 */
  summaryLabel: string;
}) {
  const [open, setOpen] = useState(false);
  if (targets.length === 0) return null;

  const row = variant === "row";
  const btnBase = row
    ? "grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-surface-2"
    : "grid size-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-surface-2 hover:text-fg";
  const iconSize = row ? "size-3.5" : "size-4";

  // Single target → direct button (no dropdown).
  if (targets.length === 1) {
    const only = targets[0];
    const glyph = (only.active && only.activeIcon) || only.icon;
    const color = row
      ? only.active
        ? "text-accent"
        : "text-fg-subtle hover:text-accent"
      : only.active
        ? "bg-surface-2 text-fg"
        : "text-fg-muted";
    return (
      <button
        onClick={only.onSelect}
        title={only.label}
        className={cn(btnBase, color)}
      >
        <Glyph icon={glyph} className={iconSize} />
      </button>
    );
  }

  // Multiple → summary button + dropdown to pick a target.
  const anyActive = targets.some((tg) => tg.active);
  const summaryGlyph = (anyActive && summaryActiveIcon) || summaryIcon;
  const summaryColor = row
    ? anyActive
      ? "text-accent"
      : "text-fg-subtle hover:text-accent"
    : open
      ? "bg-surface-2 text-fg"
      : "text-fg-muted";
  const menuPos = row ? "right-0 top-8" : "left-0 top-9";
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={summaryLabel}
        className={cn(btnBase, summaryColor)}
      >
        <Glyph icon={summaryGlyph} className={iconSize} />
      </button>
      {open && (
        <>
          <button
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            className={cn(
              "absolute z-50 flex min-w-40 flex-col overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-[var(--shadow)]",
              menuPos,
            )}
          >
            {targets.map((tg) => (
              <button
                key={tg.id}
                onClick={() => {
                  setOpen(false);
                  tg.onSelect();
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-surface-2"
              >
                <Glyph
                  icon={(tg.active && tg.activeIcon) || tg.icon}
                  className={cn("size-3.5", tg.active && "text-accent")}
                />
                {tg.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
