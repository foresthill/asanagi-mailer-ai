"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, SquarePen, Sparkles, Check } from "lucide-react";
import type {
  ContactLabel,
  Email,
  EmailAddress,
  Importance,
  ResolvedContactMeta,
} from "@/lib/types";
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

      {/* key=email → remount per contact, so state resets without effect churn.
          sampleBody = 直近の受信メール本文（署名からAIで会社名を取り込む素材）。 */}
      <ContactMetaEditor
        key={contact.email}
        email={contact.email}
        sampleBody={
          messages
            ?.filter((m) => m.state !== "sent")
            .slice(-1)[0]
            ?.body?.trim() || undefined
        }
      />

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

const LABELS: ContactLabel[] = ["vip", "normal", "spam"];
const LABEL_STYLE: Record<ContactLabel, string> = {
  vip: "border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  normal: "border-border bg-surface-2 text-fg-muted",
  spam: "border-high/40 bg-high-soft text-high",
};

/**
 * Per-contact metadata editor (label / company / honorific / tags). Edits the
 * PERSON-scope entry; the company(domain) defaults show as placeholders so you
 * see what is inherited. local-first: saved to .data only. Values are never
 * fabricated — company/honorific are typed by the user (or, later, AI-copied
 * from the signature for confirmation).
 */
function ContactMetaEditor({
  email,
  sampleBody,
}: {
  email: string;
  /** Latest inbound body — source for AI company extraction from the signature. */
  sampleBody?: string;
}) {
  const { t } = useI18n();
  const domain = email.split("@")[1] ?? "";
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState<ContactLabel | undefined>();
  const [company, setCompany] = useState("");
  const [honorific, setHonorific] = useState("");
  const [tags, setTags] = useState("");
  const [inherited, setInherited] = useState<ResolvedContactMeta | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // AI signature extraction (fills the company field as a suggestion to confirm).
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);

  async function aiImportCompany() {
    if (!sampleBody) return;
    setAiBusy(true);
    setAiMsg(null);
    try {
      const res = await fetch("/api/ai/extract-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: sampleBody }),
      });
      const d = (await res.json()) as {
        company?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(d.error ?? "failed");
      if (d.company) {
        setCompany(d.company);
        setSaved(false);
        setAiMsg(t("contact.meta.aiFilled"));
      } else {
        setAiMsg(t("contact.meta.aiNone"));
      }
    } catch {
      setAiMsg(t("contact.meta.aiFailed"));
    } finally {
      setAiBusy(false);
    }
  }

  useEffect(() => {
    // Component is keyed by email (remounts per contact), so state starts fresh;
    // this effect only loads. setState happens in the async callback (allowed).
    let active = true;
    (async () => {
      try {
        // All entries → pick this person's own row + the domain defaults.
        const res = await fetch("/api/contacts/meta");
        const data = (await res.json()) as {
          entries?: {
            key: string;
            scope: string;
            label?: ContactLabel;
            company?: string;
            honorific?: string;
            tags?: string[];
          }[];
        };
        if (!active) return;
        const rows = data.entries ?? [];
        const person = rows.find(
          (r) =>
            r.scope === "person" && r.key.toLowerCase() === email.toLowerCase(),
        );
        const dom = rows.find(
          (r) => r.scope === "domain" && r.key === domain.toLowerCase(),
        );
        setLabel(person?.label);
        setCompany(person?.company ?? "");
        setHonorific(person?.honorific ?? "");
        setTags((person?.tags ?? []).join(", "));
        setInherited(
          dom
            ? {
                label: dom.label,
                company: dom.company,
                honorific: dom.honorific,
                tags: dom.tags ?? [],
              }
            : null,
        );
      } catch {
        /* editor is best-effort */
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [email, domain]);

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/contacts/meta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: email,
          scope: "person",
          label: label ?? null,
          company,
          honorific,
          tags: tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-6 py-2.5 text-xs">
      <span className="flex items-center gap-1">
        {LABELS.map((l) => (
          <button
            key={l}
            onClick={() => {
              setLabel((cur) => (cur === l ? undefined : l));
              setSaved(false);
            }}
            className={
              "rounded-full border px-2 py-0.5 font-medium transition-colors " +
              (label === l
                ? LABEL_STYLE[l]
                : "border-border text-fg-subtle hover:text-fg")
            }
          >
            {t(`contact.meta.${l}`)}
          </button>
        ))}
      </span>
      <input
        value={company}
        onChange={(e) => {
          setCompany(e.target.value);
          setSaved(false);
        }}
        placeholder={inherited?.company || t("contact.meta.company")}
        className="w-40 rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
        title={t("contact.meta.company.hint")}
      />
      {/* 署名からAIで会社名を取り込む（コピー抽出・確認して保存）。 */}
      {sampleBody && (
        <button
          onClick={aiImportCompany}
          disabled={aiBusy}
          title={t("contact.meta.aiImport.hint")}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {aiBusy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
          {t("contact.meta.aiImport")}
        </button>
      )}
      <input
        value={honorific}
        onChange={(e) => {
          setHonorific(e.target.value);
          setSaved(false);
        }}
        placeholder={inherited?.honorific || t("contact.meta.honorific")}
        className="w-20 rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
      />
      <input
        value={tags}
        onChange={(e) => {
          setTags(e.target.value);
          setSaved(false);
        }}
        placeholder={t("contact.meta.tags")}
        className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
      />
      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
      >
        {saving ? (
          <Loader2 className="size-3 animate-spin" />
        ) : saved ? (
          <Check className="size-3" />
        ) : null}
        {saved ? t("contact.meta.saved") : t("contact.meta.save")}
      </button>
      {aiMsg && (
        <span className="basis-full text-[11px] text-fg-subtle">{aiMsg}</span>
      )}
    </div>
  );
}
