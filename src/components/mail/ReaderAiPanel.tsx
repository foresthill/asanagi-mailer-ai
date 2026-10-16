"use client";

import { useState } from "react";
import {
  Sparkles,
  FileText,
  MessageCircleQuestion,
  Languages,
  Loader2,
  X,
  CornerDownLeft,
} from "lucide-react";
import type { Email } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/**
 * 読む時のAIの入口（✨AI）。開いているメール（または会話）に対して、要約・質問・
 * 翻訳を1か所で行う。クリック時だけ各APIを呼ぶ（自動生成しない＝勝手に課金しない）。
 * 本文はPIIマスクの関所（各APIルート側）を通してからAIへ。
 */

type Tab = "summary" | "ask" | "translate";

interface Digest {
  summary: string;
  decisions: string[];
  open: string[];
  nextActions: string[];
  keyDates: string[];
  participants: string[];
}

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
  /** 会話の全メッセージ（スレッドのとき）。1通表示では undefined。 */
  thread?: Email[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("summary");
  const hasThread = (thread?.length ?? 0) > 1;

  // --- 要約（thread-digest を1通/会話に流用） ---
  const [digest, setDigest] = useState<Digest | null>(null);
  const [digScope, setDigScope] = useState<"message" | "thread" | null>(null);
  const [digesting, setDigesting] = useState(false);
  const [digErr, setDigErr] = useState<string | null>(null);
  const runDigest = async (scope: "message" | "thread") => {
    setDigesting(true);
    setDigErr(null);
    setDigScope(scope);
    const messages = scope === "thread" && thread ? thread : [email];
    try {
      const r = await fetch("/api/ai/thread-digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages, locale }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "要約に失敗しました");
      setDigest(d.digest as Digest);
    } catch (e) {
      setDigErr(e instanceof Error ? e.message : "要約に失敗しました");
    } finally {
      setDigesting(false);
    }
  };

  // --- 質問（Q&A） ---
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
      if (!r.ok) throw new Error(d.error ?? "回答に失敗しました");
      setAnswer(d.answer as string);
    } catch (e) {
      setAskErr(e instanceof Error ? e.message : "回答に失敗しました");
    } finally {
      setAsking(false);
    }
  };

  // --- 翻訳（見せ方行から移設） ---
  const [tr, setTr] = useState<{
    lang?: string;
    loading: boolean;
    text?: string;
    error?: string;
  }>({ loading: false });
  const translate = async (code: string) => {
    setTr({ lang: code, loading: true });
    try {
      const r = await fetch("/api/ai/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: email.body || email.snippet, target: code }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? t("translate.failed"));
      setTr({ lang: code, loading: false, text: d.text });
    } catch (e) {
      setTr({
        lang: code,
        loading: false,
        error: e instanceof Error ? e.message : t("translate.failed"),
      });
    }
  };

  const renderTab = (id: Tab, Icon: typeof FileText, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
        tab === id
          ? "bg-accent text-white"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );

  return (
    <div className="mt-4 rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="size-4 text-accent" />
        <span className="text-xs font-semibold text-accent">AI</span>
        <div className="ml-1 flex items-center gap-1">
          {renderTab("summary", FileText, "要約・要点")}
          {renderTab("ask", MessageCircleQuestion, "質問")}
          {renderTab("translate", Languages, "翻訳")}
        </div>
        <button
          onClick={onClose}
          title="閉じる"
          className="ml-auto grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* 要約・要点（＋次アクション＝ToDoの素） */}
      {tab === "summary" && (
        <div className="flex flex-col gap-2">
          {!digest && !digesting && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => runDigest("message")}
                className="rounded-lg border border-accent/40 bg-surface px-3 py-1.5 text-xs font-medium text-accent hover:opacity-90"
              >
                このメールを要約
              </button>
              {hasThread && (
                <button
                  onClick={() => runDigest("thread")}
                  className="rounded-lg border border-accent/40 bg-surface px-3 py-1.5 text-xs font-medium text-accent hover:opacity-90"
                >
                  この会話を要約（{thread!.length}通）
                </button>
              )}
            </div>
          )}
          {digesting && (
            <p className="flex items-center gap-2 text-xs text-fg-muted">
              <Loader2 className="size-3.5 animate-spin" />
              {digScope === "thread" ? "会話を要約中…" : "要約中…"}
            </p>
          )}
          {digErr && <p className="text-xs text-high">{digErr}</p>}
          {digest && (
            <div className="rounded-lg border border-border bg-surface p-3">
              {digest.summary && (
                <p className="whitespace-pre-wrap text-sm leading-6 text-fg/90">
                  {digest.summary}
                </p>
              )}
              <DigestList label="決定事項" items={digest.decisions} />
              <DigestList label="未決・宿題" items={digest.open} />
              <DigestList label="次アクション" items={digest.nextActions} />
              <DigestList label="キー日付" items={digest.keyDates} />
              <DigestList label="登場人物" items={digest.participants} />
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={() => {
                    setDigest(null);
                    setDigScope(null);
                  }}
                  className="text-[11px] text-fg-subtle hover:text-fg"
                >
                  やり直す
                </button>
                <span className="text-[10px] text-fg-subtle">
                  AIが要約（PIIはマスクして送信）。重要点は原文で確認を。
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 質問（Q&A） */}
      {tab === "ask" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask();
              }}
              rows={2}
              placeholder={
                hasThread
                  ? "この会話について質問（例: 結局いつまでに何をすればいい？）"
                  : "このメールについて質問（例: 何を求められてる？）"
              }
              className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={ask}
              disabled={asking || !question.trim()}
              title="送信（⌘/Ctrl+Enter）"
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {asking ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CornerDownLeft className="size-3.5" />
              )}
              送信
            </button>
          </div>
          {askErr && <p className="text-xs text-high">{askErr}</p>}
          {answer && (
            <div className="whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 text-sm leading-6 text-fg/90">
              {answer}
            </div>
          )}
          {answer && (
            <span className="text-[10px] text-fg-subtle">
              本文を根拠にAIが回答（PIIはマスクして送信）。重要点は原文で確認を。
            </span>
          )}
        </div>
      )}

      {/* 翻訳 */}
      {tab === "translate" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-fg-subtle">言語:</span>
            {LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => translate(l.code)}
                disabled={tr.loading}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-60",
                  tr.lang === l.code
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-fg-muted hover:border-accent hover:text-accent",
                )}
              >
                {l.label}
              </button>
            ))}
            {tr.loading && (
              <Loader2 className="size-3.5 animate-spin text-fg-subtle" />
            )}
          </div>
          {tr.error && <p className="text-[11px] text-high">{tr.error}</p>}
          {tr.text && (
            <div className="whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-fg">
              {tr.text}
            </div>
          )}
          <span className="text-[10px] text-fg-subtle">{t("translate.note")}</span>
        </div>
      )}
    </div>
  );
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
