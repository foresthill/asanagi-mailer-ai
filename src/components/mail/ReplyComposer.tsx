"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Send,
  Clock,
  X,
  Loader2,
  ArrowUp,
  Check,
  Wand2,
  CheckCheck,
} from "lucide-react";
import type { Email } from "@/lib/types";
import { displayName } from "./helpers";
import { ScheduleDialog } from "./ScheduleDialog";
import { buildSegments, pendingCount } from "@/lib/diff";
import { DraftEditor, type DraftEditorHandle } from "./tiptap/DraftEditor";

const QUICK_PROMPTS = ["もっと丁寧に", "もっと短く", "カジュアルに", "英語にして", "感謝を加えて"];

interface HistoryItem {
  id: string;
  instruction: string;
  scope: "selection" | "whole";
  count: number;
}

export function ReplyComposer({
  email,
  mode,
  aiConfigured,
  onSent,
  onClose,
}: {
  email: Email;
  /** "ai" = AI drafts the reply first; "plain" = start from a blank reply. */
  mode: "ai" | "plain";
  aiConfigured: boolean;
  onSent: (kind: "sent" | "scheduled") => void;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(
    email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`,
  );
  const [initialDraft, setInitialDraft] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(0);
  const [generating, setGenerating] = useState(mode === "ai");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const editorRef = useRef<DraftEditorHandle>(null);

  const reviewing = pending > 0;

  // Initial draft. Plain mode skips the AI entirely — just a bare greeting
  // skeleton so the user writes the reply themselves.
  useEffect(() => {
    if (mode === "plain") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init, no fetch
      setInitialDraft(`${displayName(email.from)} 様\n\n`);
      setGenerating(false);
      return;
    }
    let active = true;
    (async () => {
      setGenerating(true);
      try {
        const res = await fetch("/api/ai/reply", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (active && data.draft) {
          setSubject(data.draft.subject);
          setInitialDraft(data.draft.body);
        }
      } catch {
        if (active)
          setInitialDraft(
            `${displayName(email.from)} 様\n\nご連絡ありがとうございます。\n\n\nよろしくお願いいたします。`,
          );
      } finally {
        if (active) setGenerating(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSuggest(instruction: string, scope: "selection" | "whole") {
    if (!instruction.trim() || busy || reviewing) return;
    const sel = scope === "selection" && selectionText ? selectionText : null;
    setBusy(true);
    setNote(null);
    setInput("");
    try {
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          draft: body,
          instruction,
          selection: sel ? { start: 0, end: 0, text: sel } : undefined,
        }),
      });
      const data = await res.json();
      const revised: string = data.revised ?? body;
      const segs = buildSegments(body, revised);
      const changes = pendingCount(segs);
      setHistory((h) => [...h, { id: `t${h.length}`, instruction, scope, count: changes }]);
      if (changes === 0) {
        setNote(data.ai === false ? "AIキー未設定のため変更なし" : "変更はありませんでした");
      } else {
        editorRef.current?.loadReview(segs);
      }
    } catch {
      setNote("提案の生成に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    setSending(true);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: [email.from],
          subject,
          body,
          inReplyTo: email.messageId,
          account: email.account, // reply from the account the email belongs to
        }),
      });
      if (!res.ok) throw new Error("送信に失敗しました");
      onSent("sent");
    } catch (e) {
      alert(e instanceof Error ? e.message : "送信に失敗しました");
      setSending(false);
    }
  }

  async function schedule(iso: string) {
    setShowSchedule(false);
    setSending(true);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            to: [email.from],
            subject,
            body,
            inReplyTo: email.messageId,
            account: email.account,
          },
          sendAt: iso,
        }),
      });
      if (!res.ok) throw new Error("予約に失敗しました");
      onSent("scheduled");
    } catch (e) {
      alert(e instanceof Error ? e.message : "予約に失敗しました");
      setSending(false);
    }
  }

  const canSend = !sending && !generating && !busy && !reviewing && !!body;

  return (
    <div className="flex flex-1 overflow-hidden bg-bg">
      {/* Draft editor */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-surface px-5 py-3">
          <h2 className="text-sm font-semibold">
            {mode === "ai" ? "AIで返信を作成" : "返信を作成"}
          </h2>
          <span className="truncate text-xs text-fg-subtle">
            宛先: {displayName(email.from)} &lt;{email.from.email}&gt;
          </span>
          <button
            onClick={onClose}
            className="ml-auto grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden px-6 py-4">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="件名"
            className="w-full border-b border-border bg-transparent pb-2 text-base font-medium outline-none placeholder:text-fg-subtle"
          />

          {/* Selection action bar */}
          {selectionText && !reviewing && !generating && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs animate-in">
              <Wand2 className="size-3.5 text-accent" />
              <span className="text-accent">選択範囲を修正:</span>
              {["丁寧に", "短く", "言い換え"].map((p) => (
                <button
                  key={p}
                  onClick={() => runSuggest(p, "selection")}
                  className="rounded-full border border-accent/40 bg-surface px-2 py-0.5 text-fg-muted hover:text-accent"
                >
                  {p}
                </button>
              ))}
              <span className="text-fg-subtle">または右で自由に指示</span>
            </div>
          )}

          <div className="relative mt-3 flex-1 overflow-y-auto">
            <DraftEditor
              ref={editorRef}
              loadText={initialDraft}
              onChange={({ text, pending }) => {
                setBody(text);
                setPending(pending);
              }}
              onSelectionChange={setSelectionText}
            />
            {generating && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg text-fg-subtle">
                <Loader2 className="size-5 animate-spin text-accent" />
                <p className="text-sm">AIが返信を下書きしています…</p>
              </div>
            )}
            {busy && (
              <div className="pointer-events-none absolute right-2 top-0 flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent">
                <Loader2 className="size-3 animate-spin" /> 提案を作成中…
              </div>
            )}
          </div>
        </div>

        {/* Review bar OR send controls */}
        {reviewing ? (
          <div className="flex items-center gap-2 border-t border-border bg-surface px-6 py-3">
            <span className="text-sm font-medium text-accent">{pending}件の提案を確認してください</span>
            <span className="text-xs text-fg-subtle">緑=追加 / 取り消し線=削除</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => editorRef.current?.resolveAll("before")}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2"
              >
                すべて却下
              </button>
              <button
                onClick={() => editorRef.current?.resolveAll("after")}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
              >
                <CheckCheck className="size-4" />
                すべて採用
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-t border-border bg-surface px-6 py-3">
            <button
              onClick={sendNow}
              disabled={!canSend}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              今すぐ送信
            </button>
            <button
              onClick={() => setShowSchedule(true)}
              disabled={!canSend}
              className="flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <Clock className="size-4" />
              予約送信
            </button>
            <button
              onClick={onClose}
              className="ml-auto rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-surface-2"
            >
              破棄
            </button>
          </div>
        )}
      </div>

      {/* AI assistant rail */}
      <div className="flex w-[360px] shrink-0 flex-col border-l border-border bg-surface-2">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="grid size-6 place-items-center rounded-md bg-accent text-accent-fg">
            <Sparkles className="size-3.5" />
          </div>
          <span className="text-sm font-semibold">AIアシスタント</span>
          {!aiConfigured && <span className="ml-auto text-[10px] text-fg-subtle">簡易モード</span>}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <p className="rounded-xl bg-surface px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
            本文を範囲選択して「ここをこうして」と指示するか、下の入力で全体に指示できます。
            提案は<strong>一箇所ずつ採用/却下</strong>できます。
          </p>

          {history.map((h) => (
            <div key={h.id} className="space-y-1">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm text-accent-fg">
                  {h.scope === "selection" && (
                    <span className="mr-1 rounded bg-white/20 px-1 text-[10px]">範囲</span>
                  )}
                  {h.instruction}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
                <Check className="size-3" />
                {h.count > 0 ? `${h.count}件の提案を作成` : "変更なし"}
              </div>
            </div>
          ))}
          {note && <div className="text-xs text-fg-subtle">{note}</div>}
          {busy && (
            <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <Loader2 className="size-3 animate-spin" /> 考え中…
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-2.5">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => runSuggest(p, "whole")}
              disabled={busy || generating || reviewing}
              className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-surface px-3 py-2 focus-within:border-accent">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  runSuggest(input, selectionText ? "selection" : "whole");
                }
              }}
              rows={1}
              placeholder={selectionText ? "選択範囲への指示…" : "全体への指示…"}
              disabled={reviewing}
              className="max-h-24 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-fg-subtle disabled:opacity-50"
            />
            <button
              onClick={() => runSuggest(input, selectionText ? "selection" : "whole")}
              disabled={busy || generating || reviewing || !input.trim()}
              className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg transition-opacity disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {showSchedule && (
        <ScheduleDialog onSchedule={schedule} onClose={() => setShowSchedule(false)} />
      )}
    </div>
  );
}
