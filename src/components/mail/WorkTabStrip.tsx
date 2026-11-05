"use client";

import { Mail, PenLine, X } from "lucide-react";

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
}: {
  tabs: WorkTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="tablist"
      className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-1.5"
    >
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
    </div>
  );
}
