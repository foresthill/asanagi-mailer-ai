"use client";

import { ChevronLeft, ChevronRight, Mail, PenLine, X, XCircle } from "lucide-react";

import { useI18n } from "@/lib/i18n";

import type { WorkTab } from "./useWorkTabs";

/**
 * The strip of open work surfaces (opened mail + in-progress drafts). Clicking
 * a tab focuses it; the × closes it. A compose tab stays here until closed, so
 * returning to a half-written message is always one click away (痛み①の解消).
 */
export function WorkTabStrip({
  tabs,
  activeId,
  onActivate,
  onClose,
  onCloseAll,
  onBack,
  onForward,
  canBack,
  canForward,
}: {
  tabs: WorkTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** Close every open tab at once (confirms if any compose tab is unsent). */
  onCloseAll?: () => void;
  /** ブラウザ戻る/進む: move focus along the tab history (never closes a tab). */
  onBack?: () => void;
  onForward?: () => void;
  canBack?: boolean;
  canForward?: boolean;
}) {
  const { t } = useI18n();
  const navBtn =
    "grid size-7 shrink-0 place-items-center self-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-30";
  return (
    <div
      role="tablist"
      className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-1.5"
    >
      {(onBack || onForward) && (
        <div className="flex shrink-0 items-center gap-0.5 pr-1">
          <button
            type="button"
            onClick={onBack}
            disabled={!canBack}
            aria-label={t("tabs.back")}
            title={t("tabs.back")}
            className={navBtn}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={onForward}
            disabled={!canForward}
            aria-label={t("tabs.forward")}
            title={t("tabs.forward")}
            className={navBtn}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const Icon = tab.kind === "compose" ? PenLine : Mail;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => onActivate(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate(tab.id);
              }
            }}
            className={`group flex min-w-[8rem] max-w-[14rem] cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm outline-none transition-colors ${
              active
                ? "bg-bg font-medium text-fg shadow-[var(--shadow)]"
                : "text-fg-muted hover:bg-surface-2"
            }`}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{tab.title}</span>
            <button
              type="button"
              aria-label={t("tabs.close")}
              title={t("tabs.close")}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className={`grid size-5 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg ${
                active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
      {/* 「すべて閉じる」: タブが増えて閉じ忘れたときの一括クローズ（2枚以上で表示）。
          作成中(未送信)が含まれる場合は呼び出し側が破棄確認を出す。 */}
      {onCloseAll && tabs.length >= 2 && (
        <button
          type="button"
          onClick={onCloseAll}
          title={t("tabs.closeAll")}
          className="ml-auto flex shrink-0 items-center gap-1 self-center rounded-lg px-2 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <XCircle className="size-3.5 shrink-0" />
          <span className="whitespace-nowrap">{t("tabs.closeAll")}</span>
        </button>
      )}
    </div>
  );
}
