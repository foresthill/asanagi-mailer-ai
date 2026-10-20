"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  FileText,
  MessageCircleQuestion,
  Languages,
  Loader2,
  X,
  CornerDownLeft,
  Copy,
  Check,
  Trash2,
  RotateCcw,
} from "lucide-react";
import type { Email, AiSummary, AiCacheEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/**
 * 読む時のAI（✨AI）。開いているメール（会話）に対し要約・質問・翻訳を行い、本文の
 * 右（広い時）/下（狭い時）に出す。訳文・要約は .data に保存し、開き直しても残る。
 * クリック時だけ各APIを呼ぶ（自動生成しない）。本文はPIIマスクの関所を通してAIへ。
 */

type Tab = "summary" | "ask" | "translate";
type Scope = "message" | "thread";

const LANGS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
];

export function ReaderAiPanel({
  email,
  thread,
  onClose,
}: {
  email: Email;
  thread?: Email[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("summary");
  const hasThread = (thread?.length ?? 0) > 1;

  // 保存済み出力（メールごと）。マウント時に読み込む（email.id で remount）。
  const [trMap, setTrMap] = useState<Record<string, string>>({});
  const [sumMap, setSumMap] = useState<Partial<Record<Scope, AiSummary>>>({});
  const [trLang, setTrLang] = useState<string | null>(null);
  const [sumScope, setSumScope] = useState<Scope | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `/api/ai/cache?id=${encodeURIComponent(email.id)}`,
        );
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        const c = (d?.cache ?? {}) as AiCacheEntry;
        setTrMap(c.translations ?? {});
        setSumMap(c.summaries ?? {});
        const langs = Object.keys(c.translations ?? {});
        if (langs.length) setTrLang(langs[0]);
        if (c.summaries?.message) setSumScope("message");
        else if (c.summaries?.thread) setSumScope("thread");
      } catch {
        /* no cache yet */
      }
    })();
    return () => {
      alive = false;
    };
  }, [email.id]);

  const saveCache = (patch: AiCacheEntry) => {
    void fetch("/api/ai/cache", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: email.id, ...patch }),
    }).catch(() => {});
  };
  const deleteCache = (kind: "translation" | "summary", key: string) => {
    void fetch(
      `/api/ai/cache?id=${encodeURIComponent(email.id)}&kind=${kind}&key=${encodeURIComponent(key)}`,
      { method: "DELETE" },
    ).catch(() => {});
  };

  // --- 要約（thread-digest を1通/会話に流用、結果は保存） ---
  const [digesting, setDigesting] = useState<Scope | null>(null);
  const [digErr, setDigErr] = useState<string | null>(null);
  const runDigest = async (scope: Scope) => {
    setDigesting(scope);
    setDigErr(null);
    setSumScope(scope);
    const messages = scope === "thread" && thread ? thread : [email];
    try {
      const r = await fetch("/api/ai/thread-digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages, locale }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? t("translate.failed"));
      const digest = d.digest as AiSummary;
      setSumMap((m) => ({ ...m, [scope]: digest }));
      saveCache({ summaries: { [scope]: digest } });
    } catch (e) {
      setDigErr(e instanceof Error ? e.message : t("translate.failed"));
    } finally {
      setDigesting(null);
    }
  };
  const clearSummary = (scope: Scope) => {
    setSumMap((m) => {
      const next = { ...m };
      delete next[scope];
      return next;
    });
    if (sumScope === scope) setSumScope(null);
    deleteCache("summary", scope);
  };

  // --- 質問（Q&A・保存はしない） ---
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);
  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setAskErr(null);
    setAnswer(null);
    const messages = hasThread && thread ? thread : [email];
    try {
      const r = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages, question: q, locale }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? t("translate.failed"));
      setAnswer(d.answer as string);
    } catch (e) {
      setAskErr(e instanceof Error ? e.message : t("translate.failed"));
    } finally {
      setAsking(false);
    }
  };

  // --- 翻訳（結果は保存。保存済みは即表示） ---
  const [trLoading, setTrLoading] = useState(false);
  const [trErr, setTrErr] = useState<string | null>(null);
  const translate = async (code: string) => {
    setTrLang(code);
    setTrErr(null);
    // 保存済みがあれば即表示（再取得しない）。
    if (trMap[code]) return;
    setTrLoading(true);
    try {
      const r = await fetch("/api/ai/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: email.body || email.snippet, target: code }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? t("translate.failed"));
      const text = d.text as string;
      setTrMap((m) => ({ ...m, [code]: text }));
      saveCache({ translations: { [code]: text } });
    } catch (e) {
      setTrErr(e instanceof Error ? e.message : t("translate.failed"));
    } finally {
      setTrLoading(false);
    }
  };
  const retranslate = async (code: string) => {
    setTrMap((m) => {
      const next = { ...m };
      delete next[code];
      return next;
    });
    deleteCache("translation", code);
    // 消してから取り直す。
    setTrLang(code);
    setTrErr(null);
    setTrLoading(true);
    try {
      const r = await fetch("/api/ai/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: email.body || email.snippet, target: code }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? t("translate.failed"));
      const text = d.text as string;
      setTrMap((m) => ({ ...m, [code]: text }));
      saveCache({ translations: { [code]: text } });
    } catch (e) {
      setTrErr(e instanceof Error ? e.message : t("translate.failed"));
    } finally {
      setTrLoading(false);
    }
  };
  const clearTranslation = (code: string) => {
    setTrMap((m) => {
      const next = { ...m };
      delete next[code];
      return next;
    });
    if (trLang === code) setTrLang(null);
    deleteCache("translation", code);
  };

  const renderTab = (id: Tab, Icon: typeof FileText, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={cn(
        "flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors",
        tab === id
          ? "bg-accent text-white"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );

  const shownSummary = sumScope ? sumMap[sumScope] : undefined;
  const shownTranslation = trLang ? trMap[trLang] : undefined;

  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="size-4 shrink-0 text-accent" />
        <div className="flex flex-wrap items-center gap-1">
          {renderTab("summary", FileText, "要約")}
          {renderTab("ask", MessageCircleQuestion, "質問")}
          {renderTab("translate", Languages, "翻訳")}
        </div>
        <button
          onClick={onClose}
          title="閉じる"
          className="ml-auto grid size-6 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* 要約・要点 */}
      {tab === "summary" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <ScopeBtn
              label="このメール"
              active={sumScope === "message"}
              saved={!!sumMap.message}
              loading={digesting === "message"}
              onClick={() =>
                sumMap.message ? setSumScope("message") : runDigest("message")
              }
            />
            {hasThread && (
              <ScopeBtn
                label={`この会話(${thread!.length})`}
                active={sumScope === "thread"}
                saved={!!sumMap.thread}
                loading={digesting === "thread"}
                onClick={() =>
                  sumMap.thread ? setSumScope("thread") : runDigest("thread")
                }
              />
            )}
          </div>
          {digErr && <p className="text-xs text-high">{digErr}</p>}
          {shownSummary && sumScope && (
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-1.5 flex items-center gap-1">
                <CopyBtn text={summaryToText(shownSummary)} />
                <button
                  onClick={() => runDigest(sumScope)}
                  title="やり直す"
                  className="grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
                >
                  <RotateCcw className="size-3.5" />
                </button>
                <button
                  onClick={() => clearSummary(sumScope)}
                  title="この要約を削除"
                  className="grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-high"
                >
                  <Trash2 className="size-3.5" />
                </button>
                <span className="ml-auto text-[10px] text-fg-subtle">保存済み</span>
              </div>
              {shownSummary.summary && (
                <p className="whitespace-pre-wrap text-sm leading-6 text-fg/90">
                  {shownSummary.summary}
                </p>
              )}
              <DigestList label="決定事項" items={shownSummary.decisions} />
              <DigestList label="未決・宿題" items={shownSummary.open} />
              <DigestList label="次アクション" items={shownSummary.nextActions} />
              <DigestList label="キー日付" items={shownSummary.keyDates} />
              <DigestList label="登場人物" items={shownSummary.participants} />
              <p className="mt-2 text-[10px] text-fg-subtle">
                AIが要約（PIIはマスクして送信）。重要点は原文で確認を。
              </p>
            </div>
          )}
        </div>
      )}

      {/* 質問（Q&A） */}
      {tab === "ask" && (
        <div className="flex flex-col gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask();
            }}
            rows={2}
            placeholder={
              hasThread
                ? "この会話について質問（例: 何をいつまでに？）"
                : "このメールについて質問（例: 何を求められてる？）"
            }
            className="w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={ask}
            disabled={asking || !question.trim()}
            title="送信（⌘/Ctrl+Enter）"
            className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {asking ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CornerDownLeft className="size-3.5" />
            )}
            送信
          </button>
          {askErr && <p className="text-xs text-high">{askErr}</p>}
          {answer && (
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-1.5 flex items-center">
                <CopyBtn text={answer} />
                <span className="ml-auto text-[10px] text-fg-subtle">
                  本文を根拠に回答
                </span>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-6 text-fg/90">
                {answer}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 翻訳 */}
      {tab === "translate" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => translate(l.code)}
                disabled={trLoading}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-60",
                  trLang === l.code
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-fg-muted hover:border-accent hover:text-accent",
                )}
              >
                {l.label}
                {trMap[l.code] && (
                  <Check className="size-3 text-emerald-600" aria-label="保存済み" />
                )}
              </button>
            ))}
            {trLoading && (
              <Loader2 className="size-3.5 animate-spin text-fg-subtle" />
            )}
          </div>
          {trErr && <p className="text-[11px] text-high">{trErr}</p>}
          {shownTranslation && trLang && (
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-1.5 flex items-center gap-1">
                <CopyBtn text={shownTranslation} />
                <button
                  onClick={() => retranslate(trLang)}
                  title="翻訳し直す"
                  className="grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
                >
                  <RotateCcw className="size-3.5" />
                </button>
                <button
                  onClick={() => clearTranslation(trLang)}
                  title="この翻訳を削除"
                  className="grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-high"
                >
                  <Trash2 className="size-3.5" />
                </button>
                <span className="ml-auto text-[10px] text-fg-subtle">保存済み</span>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
                {shownTranslation}
              </div>
            </div>
          )}
          <span className="text-[10px] text-fg-subtle">{t("translate.note")}</span>
        </div>
      )}
    </div>
  );
}

function ScopeBtn({
  label,
  active,
  saved,
  loading,
  onClick,
}: {
  label: string;
  active: boolean;
  saved: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-accent/40 bg-surface text-accent hover:opacity-90",
      )}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {label}
      {saved && !loading && (
        <Check className="size-3 text-emerald-600" aria-label="保存済み" />
      )}
    </button>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      title="コピー"
      className="grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
    >
      {done ? (
        <Check className="size-3.5 text-emerald-600" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </button>
  );
}

function summaryToText(s: AiSummary): string {
  const lines: string[] = [];
  if (s.summary) lines.push(s.summary, "");
  const sec = (label: string, items: string[]) => {
    if (items?.length) {
      lines.push(`【${label}】`);
      for (const it of items) lines.push(`・${it}`);
      lines.push("");
    }
  };
  sec("決定事項", s.decisions);
  sec("未決・宿題", s.open);
  sec("次アクション", s.nextActions);
  sec("キー日付", s.keyDates);
  sec("登場人物", s.participants);
  return lines.join("\n").trim();
}

function DigestList({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold text-fg-muted">{label}</p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 text-xs leading-5 text-fg/85">
            <span className="text-fg-subtle">・</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
