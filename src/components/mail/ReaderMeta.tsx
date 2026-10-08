"use client";

import { useState } from "react";
import {
  CalendarPlus,
  NotebookPen,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { Email, Importance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { MeetingCard } from "./MeetingCard";
import { PrivateNote } from "./PrivateNote";

/**
 * リーダー上部の付帯情報（会議・重要度・メモ）を、縦積みの大きなカードではなく
 * 1行のコンパクトなチップにまとめ、押したものだけ展開する。既定は全部畳んだ
 * 状態＝本文がすぐ読める（縦の冗長さを解消）。チップはメールごとに付く。
 */

type MetaKey = "meeting" | "importance" | "note";

function Chip({
  icon: Icon,
  label,
  active,
  onClick,
  dot,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  /** メモあり等の小さな目印。 */
  dot?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-accent bg-accent-soft text-accent"
          : danger
            ? "border-high/40 bg-high-soft text-high hover:border-high"
            : "border-border text-fg-muted hover:border-fg-subtle hover:text-fg",
      )}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
      {dot && <span className="size-1.5 rounded-full bg-amber-500" />}
    </button>
  );
}

export function ReaderMeta({
  email,
  classifying,
  hasNote,
  onImportanceFeedback,
  onNoteSaved,
}: {
  email: Email;
  classifying: boolean;
  /** この端末にメモが保存済みか（チップの目印用）。 */
  hasNote?: boolean;
  onImportanceFeedback: (i: Importance) => void;
  onNoteSaved?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Set<MetaKey>>(new Set());
  const toggle = (k: MetaKey) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const impLabel = classifying
    ? t("reader.classifying")
    : `${t("meta.importance")}: ${
        email.importance ? t(`importance.${email.importance}`) : "—"
      }`;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {email.invite && (
          <Chip
            icon={CalendarPlus}
            label={t("meta.meeting")}
            active={open.has("meeting")}
            onClick={() => toggle("meeting")}
            danger={email.invite.method?.toUpperCase() === "CANCEL"}
          />
        )}
        <Chip
          icon={Sparkles}
          label={impLabel}
          active={open.has("importance")}
          onClick={() => toggle("importance")}
        />
        <Chip
          icon={NotebookPen}
          label={t("meta.note")}
          active={open.has("note")}
          onClick={() => toggle("note")}
          dot={hasNote}
        />
      </div>

      {open.has("meeting") && email.invite && (
        <MeetingCard emailId={email.id} invite={email.invite} />
      )}

      {open.has("importance") && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5">
          {email.importanceReason ? (
            <span className="text-xs text-fg-muted">
              {email.importanceReason}
            </span>
          ) : (
            <span className="text-xs text-fg-subtle">
              {t("reader.importanceUnknown")}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-[11px] text-fg-subtle">
              {t("reader.learn")}
            </span>
            {(["high", "normal", "low"] as Importance[]).map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => onImportanceFeedback(i)}
                className="rounded-md border border-border px-2 py-0.5 text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-accent"
              >
                {t(`importance.${i}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {open.has("note") && (
        <PrivateNote emailId={email.id} onSaved={onNoteSaved} />
      )}
    </div>
  );
}
