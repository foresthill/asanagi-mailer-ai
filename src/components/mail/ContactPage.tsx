"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, SquarePen, Sparkles } from "lucide-react";
import type { Email, EmailAddress, Importance } from "@/lib/types";
import { avatarColor } from "./helpers";
import { ConversationBubbles } from "./ConversationBubbles";
import type { ContactInfo } from "@/lib/db";

const IMPORTANCE_LABEL: Record<Importance, string> = {
  high: "重要",
  normal: "通常",
  low: "低",
};

/**
 * Person page: profile header + the full conversation timeline with this
 * address (LINE-style, spans accounts and folders — powered by the cache).
 */
export function ContactPage({
  contact,
  onComposeTo,
}: {
  contact: ContactInfo;
  onComposeTo: (to: EmailAddress) => void;
}) {
  const [messages, setMessages] = useState<Email[] | null>(null);
  const [learned, setLearned] = useState<{ importance: Importance; weight: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setMessages(null);
      const res = await fetch(`/api/contacts/${encodeURIComponent(contact.email)}`);
      const data = await res.json();
      if (!active) return;
      setMessages(data.messages ?? []);
      setLearned(data.learned ?? null);
    })();
    return () => {
      active = false;
    };
  }, [contact.email]);

  useEffect(() => {
    // Latest message in view, chat-style.
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const label = contact.name || contact.email;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex items-center gap-3 border-b border-border bg-surface px-6 py-3.5">
        <div
          className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
          style={{ background: avatarColor(label) }}
        >
          {label.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-semibold">
            {label}
            {learned && (
              <span className="flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                <Sparkles className="size-3" />
                学習済み: {IMPORTANCE_LABEL[learned.importance]} (×{learned.weight})
              </span>
            )}
          </p>
          <p className="truncate text-xs text-fg-subtle">
            {contact.email}・受信 {contact.received} / 送信 {contact.sent}
          </p>
        </div>
        <button
          onClick={() => onComposeTo({ name: contact.name, email: contact.email })}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:scale-[1.02] active:scale-95"
        >
          <SquarePen className="size-4" />
          メールを書く
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-2xl">
          {messages === null ? (
            <div className="grid h-40 place-items-center text-fg-subtle">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-subtle">
              キャッシュにこの人とのメールがまだありません
            </p>
          ) : (
            <ConversationBubbles messages={messages} />
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
