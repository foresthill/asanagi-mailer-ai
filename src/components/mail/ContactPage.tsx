"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, SquarePen, Sparkles } from "lucide-react";
import type { Email, EmailAddress, Importance } from "@/lib/types";
import { avatarColor } from "./helpers";
import { useI18n } from "@/lib/i18n";
import { ConversationBubbles } from "./ConversationBubbles";
import type { ContactInfo } from "@/lib/db";

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
  const { t } = useI18n();
  const [messages, setMessages] = useState<Email[] | null>(null);
  const [learned, setLearned] = useState<{
    importance: Importance;
    weight: number;
  } | null>(null);
  // person = このアドレスだけ / company = 同じ会社（@domain の全員）の全履歴。
  // 同じ要件で担当が複数に分かれても1画面で辿れるように（相手軸の集約）。
  const [scope, setScope] = useState<"person" | "company">("person");
  const bottomRef = useRef<HTMLDivElement>(null);

  const domain = contact.email.split("@")[1] ?? "";
  // フリーメールは「会社」ではないので会社集約を出さない（誤って gmail 全員を束ねない）。
  const canCompany =
    !!domain &&
    !new Set([
      "gmail.com",
      "yahoo.co.jp",
      "yahoo.com",
      "outlook.com",
      "outlook.jp",
      "hotmail.com",
      "icloud.com",
      "me.com",
      "docomo.ne.jp",
      "ezweb.ne.jp",
      "au.com",
      "softbank.ne.jp",
      "proton.me",
    ]).has(domain.toLowerCase());

  useEffect(() => {
    let active = true;
    (async () => {
      setMessages(null);
      const qs = scope === "company" ? "?scope=company" : "";
      const res = await fetch(
        `/api/contacts/${encodeURIComponent(contact.email)}${qs}`,
      );
      const data = await res.json();
      if (!active) return;
      setMessages(data.messages ?? []);
      setLearned(data.learned ?? null);
    })();
    return () => {
      active = false;
    };
  }, [contact.email, scope]);

  // フリーメールなら会社スコープに残らない（別の人へ切替時など）。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!canCompany && scope === "company") setScope("person");
  }, [canCompany, scope]);

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
                {t("contact.learned")
                  .replace(
                    "{importance}",
                    t(`importance.${learned.importance}`),
                  )
                  .replace("{weight}", String(learned.weight))}
              </span>
            )}
          </p>
          <p className="truncate text-xs text-fg-subtle">
            {contact.email}・
            {t("contact.stats")
              .replace("{received}", String(contact.received))
              .replace("{sent}", String(contact.sent))}
          </p>
        </div>
        {canCompany && (
          <div className="flex shrink-0 rounded-lg border border-border p-0.5 text-xs">
            <button
              onClick={() => setScope("person")}
              aria-pressed={scope === "person"}
              title={t("contact.scope.person.title")}
              className={
                scope === "person"
                  ? "rounded-md bg-accent-soft px-2.5 py-1 font-medium text-accent"
                  : "rounded-md px-2.5 py-1 text-fg-subtle hover:text-fg"
              }
            >
              {t("contact.scope.person")}
            </button>
            <button
              onClick={() => setScope("company")}
              aria-pressed={scope === "company"}
              title={t("contact.scope.company.title").replace(
                "{domain}",
                domain,
              )}
              className={
                scope === "company"
                  ? "rounded-md bg-accent-soft px-2.5 py-1 font-medium text-accent"
                  : "rounded-md px-2.5 py-1 text-fg-subtle hover:text-fg"
              }
            >
              {t("contact.scope.company")}
            </button>
          </div>
        )}
        <button
          onClick={() =>
            onComposeTo({ name: contact.name, email: contact.email })
          }
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:scale-[1.02] active:scale-95"
        >
          <SquarePen className="size-4" />
          {t("contact.compose")}
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
              {t("contact.empty")}
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
