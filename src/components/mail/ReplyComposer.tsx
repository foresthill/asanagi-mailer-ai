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
import { ScheduleDialog } from "./ScheduleDialog";
import { buildSegments, pendingCount } from "@/lib/diff";
import { DraftEditor, type DraftEditorHandle } from "./tiptap/DraftEditor";
import { RecipientFields, type RecipientValues } from "./RecipientFields";
import {
  composeTitle,
  formatAddressList,
  looksLikeAddressList,
  parseAddressList,
  type ComposeInit,
} from "./compose";

const QUICK_PROMPTS = ["もっと丁寧に", "もっと短く", "カジュアルに", "英語にして", "感謝を加えて"];

interface HistoryItem {
  id: string;
  instruction: string;
  scope: "selection" | "whole";
  count: number;
}

export function ReplyComposer({
  init,
  aiConfigured,
  onSent,
  onClose,
}: {
  /** Prepared initial state (kind/mode/recipients/subject/body) — compose.ts. */
  init: ComposeInit;
  aiConfigured: boolean;
  onSent: (kind: "sent" | "scheduled") => void;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(init.subject);
  const [recipients, setRecipients] = useState<RecipientValues>({
    to: formatAddressList(init.to),
    cc: formatAddressList(init.cc),
    bcc: "",
  });
  const [initialDraft, setInitialDraft] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(0);
  const [generating, setGenerating] = useState(init.mode === "ai");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const editorRef = useRef<DraftEditorHandle>(null);
  // In-flight AI request — 中止 button aborts it (initial draft / suggest).
  const abortRef = useRef<AbortController | null>(null);

  const reviewing = pending > 0;

  const cancelAi = () => abortRef.current?.abort();

  // Initial draft. Plain modes start from the prepared body; "ai" asks the
  // model to draft a reply — or, for forwards, a short forwarding note that
  // goes above the quoted original (subject stays "Fwd:").
  // Replies keep the quoted original below the new text (メールの礼儀:
  // top-posting with the ">" quote preserved for the recipient's context).
  const withQuote = (text: string) =>
    init.quote ? `${text.replace(/\s+$/, "")}\n\n${init.quote}` : text;

  useEffect(() => {
    if (init.mode === "plain" || !init.source) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init, no fetch
      setInitialDraft(init.kind === "new" ? init.body : withQuote(init.body));
      setGenerating(false);
      return;
    }
    const source = init.source;
    const isForward = init.kind === "forward";
    let active = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    (async () => {
      setGenerating(true);
      try {
        const res = await fetch("/api/ai/reply", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            email: source,
            // Conversation so far (oldest first) — drafting context.
            history: init.history,
            guidance: isForward
              ? "このメールを第三者へ転送するための短い前置き文だけを書いてください。要点の簡潔なまとめ（2〜3行）を含め、宛名・署名・元メールの再掲は不要です。"
              : undefined,
          }),
        });
        const data = await res.json();
        if (active && data.draft) {
          if (isForward) {
            // Keep the Fwd: subject; the AI note sits above the quote block.
            setInitialDraft(`${data.draft.body.trim()}\n${init.body}`);
          } else {
            setSubject(data.draft.subject);
            setInitialDraft(withQuote(data.draft.body));
          }
        }
      } catch (e) {
        // Cancelled or failed → fall back to the plain template (editable).
        if (active) {
          setInitialDraft(isForward ? init.body : withQuote(init.body));
          if ((e as Error).name === "AbortError") setNote("生成を中止しました（手書きでどうぞ）");
        }
      } finally {
        if (active) setGenerating(false);
      }
    })();
    return () => {
      active = false;
      ctrl.abort(); // leaving the composer cancels the request too
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSuggest(instruction: string, scope: "selection" | "whole") {
    if (!instruction.trim() || busy || reviewing) return;
    const sel = scope === "selection" && selectionText ? selectionText : null;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setNote(null);
    setInput("");
    try {
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          email: init.source, // optional context (absent for new/forward)
          draft: body,
          instruction,
          selection: sel ? { start: 0, end: 0, text: sel } : undefined,
          subject, // blank → the AI proposes one alongside the revision
        }),
      });
      const data = await res.json();
      const revised: string = data.revised ?? body;
      // Fill the subject only if the user still hasn't typed one meanwhile.
      const proposedSubject =
        typeof data.subject === "string" && data.subject && !subject.trim()
          ? data.subject
          : null;
      if (proposedSubject) setSubject(proposedSubject);
      const segs = buildSegments(body, revised);
      const changes = pendingCount(segs);
      setHistory((h) => [...h, { id: `t${h.length}`, instruction, scope, count: changes }]);
      if (changes === 0) {
        setNote(
          data.ai === false
            ? "AIキー未設定のため変更なし"
            : proposedSubject
              ? "件名を提案しました（本文は変更なし）"
              : "変更はありませんでした",
        );
      } else {
        if (proposedSubject) setNote("件名も提案しました（変更できます）");
        editorRef.current?.loadReview(segs);
      }
    } catch (e) {
      setNote((e as Error).name === "AbortError" ? "提案を中止しました" : "提案の生成に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  /** Outgoing message built from the editable recipient fields. */
  function outgoing() {
    return {
      to: parseAddressList(recipients.to),
      cc: parseAddressList(recipients.cc),
      bcc: parseAddressList(recipients.bcc),
      subject,
      body,
      inReplyTo: init.inReplyTo,
      threadId: init.threadId,
      account: init.account, // send from the account the thread belongs to
    };
  }

  async function sendNow() {
    setSending(true);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(outgoing()),
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
        body: JSON.stringify({ message: outgoing(), sendAt: iso }),
      });
      if (!res.ok) throw new Error("予約に失敗しました");
      onSent("scheduled");
    } catch (e) {
      alert(e instanceof Error ? e.message : "予約に失敗しました");
      setSending(false);
    }
  }

  const canSend =
    !sending &&
    !generating &&
    !busy &&
    !reviewing &&
    !!body &&
    !!subject.trim() &&
    looksLikeAddressList(recipients.to);

  return (
    <div className="flex flex-1 overflow-hidden bg-bg">
      {/* Draft editor */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-surface px-5 py-3">
          <h2 className="text-sm font-semibold">{composeTitle(init)}</h2>
          {init.account && (
            <span className="truncate text-xs text-fg-subtle">送信元: {init.account}</span>
          )}
          <button
            onClick={onClose}
            className="ml-auto grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden px-6 py-4">
          <RecipientFields values={recipients} onChange={setRecipients} disabled={sending} />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="件名"
            className="mt-1.5 w-full border-b border-border bg-transparent pb-2 text-base font-medium outline-none placeholder:text-fg-subtle"
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
                <button
                  onClick={cancelAi}
                  className="mt-1 rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-high hover:text-high"
                >
                  中止して自分で書く
                </button>
              </div>
            )}
            {busy && (
              <div className="absolute right-2 top-0 flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent">
                <Loader2 className="size-3 animate-spin" /> 提案を作成中…
                <button
                  onClick={cancelAi}
                  title="提案の生成を中止"
                  className="rounded-full px-1.5 font-medium underline-offset-2 hover:underline"
                >
                  中止
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Review bar OR send controls */}
        {reviewing ? (
          <div className="flex items-center gap-2 border-t border-border bg-surface px-6 py-3">
            <span className="text-sm font-medium text-accent">{pending}件の提案を確認してください</span>
            <span className="text-xs text-fg-subtle">
              緑=追加 / 取り消し線=削除。<strong>すべて採用/却下するまで送信できません</strong>
            </span>
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
                if (e.key !== "Enter") return;
                // Never fire while the IME is composing (Japanese input:
                // the conversion-confirm Enter must not send).
                if (e.nativeEvent.isComposing) return;
                // Enter = newline; Shift/Cmd/Ctrl+Enter = send.
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  runSuggest(input, selectionText ? "selection" : "whole");
                }
              }}
              rows={1}
              placeholder={
                (selectionText ? "選択範囲への指示" : "全体への指示") + "（Shift+Enterで送信）"
              }
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
