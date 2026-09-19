"use client";

import { useState } from "react";
import { ChevronDown, Forward, Reply, ReplyAll, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { ComposeAI, ComposeKind } from "./compose";

/**
 * Reply / AI-reply split buttons shared by the reader's action bar and each
 * thread message card, so per-message replies use the exact same layout and
 * menu (全員に返信 / AIで全員に返信 / 転送) as the top bar. Both take the same
 * onReply(kind, mode) contract; the caller decides the target message.
 */

/** Plain reply as a split button — 返信 primary, 全員に返信/転送 in a menu. */
export function ReplyButton({ onReply }: { onReply: (kind: ComposeKind, mode: ComposeAI) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div className="flex items-center overflow-hidden rounded-lg border border-border bg-surface">
        <button
          onClick={() => onReply("reply", "plain")}
          title={t("reply.reply.title")}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Reply className="size-4" />
          {t("reply.reply")}
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          title={t("reply.more.title")}
          className="grid h-full place-items-center border-l border-border px-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow)]">
            <button
              onClick={() => {
                setOpen(false);
                onReply("replyAll", "plain");
              }}
              title={t("reply.replyAll.title")}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <ReplyAll className="size-4" />
              {t("reply.replyAll")}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onReply("forward", "plain");
              }}
              title={t("reply.forward.title")}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <Forward className="size-4" />
              {t("reply.forward")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Primary AI action with a small menu: AIで返信 (default) / AIで全員に返信 / AIで転送. */
export function AiReplyButton({ onReply }: { onReply: (kind: ComposeKind, mode: ComposeAI) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div className="flex items-center overflow-hidden rounded-lg bg-accent shadow-sm">
        <button
          onClick={() => onReply("reply", "ai")}
          title={t("reply.ai.title")}
          className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          <Sparkles className="size-4" />
          {t("reply.ai")}
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          title={t("reply.aiMore.title")}
          className="grid h-full place-items-center border-l border-white/25 px-1.5 text-accent-fg transition-opacity hover:opacity-90"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow)]">
            <button
              onClick={() => {
                setOpen(false);
                onReply("replyAll", "ai");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <ReplyAll className="size-4" />
              {t("reply.aiAll")}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onReply("forward", "ai");
              }}
              title={t("reply.aiForward.title")}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <Forward className="size-4" />
              {t("reply.aiForward")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
