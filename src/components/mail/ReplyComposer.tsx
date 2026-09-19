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
  Save,
  Code2,
  Image as ImageIcon,
  Minimize2,
  Maximize2,
} from "lucide-react";
import { ScheduleDialog } from "./ScheduleDialog";
import { SendConfirmDialog } from "./SendConfirmDialog";
import DOMPurify from "dompurify";
import { AttachmentButton, AttachmentChips, fileToOutgoingAttachment } from "./AttachmentBar";
import { ATTACHMENT_TOTAL_CAP, totalAttachmentBytes } from "@/lib/attachments";
import { plainTextToHtml, wrapHtmlBody, quoteBlock, extractInlineImages } from "@/lib/html-mail";
import { formatBytes } from "./StorageMeter";
import { useI18n } from "@/lib/i18n";
import type { OutgoingAttachment } from "@/lib/types";
import { buildSegments, pendingCount } from "@/lib/diff";
import { DraftEditor, type DraftEditorHandle } from "./tiptap/DraftEditor";
import { RichEditor, type RichEditorHandle } from "./tiptap/RichEditor";
import { RecipientFields, type RecipientValues } from "./RecipientFields";
import {
  composeTitle,
  formatAddressList,
  looksLikeAddressList,
  parseAddressList,
  splitQuotedDraft,
  type ComposeInit,
} from "./compose";
import type { AccountInfo } from "@/lib/email/accounts";

// 表示＝AIへ送る命令を兼ねる。ロケール別に t() で解決した文字列をそのまま指示に使う
// （AIは各言語の指示を解釈する）。
const QUICK_PROMPT_KEYS = [
  "composer.preset.polite",
  "composer.preset.shorter",
  "composer.preset.casual",
  "composer.preset.english",
  "composer.preset.thanks",
] as const;

// AIアシスタントの指示入力での送信キー設定（端末に保存）。
// true: Enter=送信 / Shift+Enter=改行。 false(既定): Enter=改行 / Shift+Enter=送信。
const ENTER_SEND_KEY = "asanagi:ai-enter-send";
function loadEnterSend(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ENTER_SEND_KEY) === "1";
}

interface HistoryItem {
  id: string;
  instruction: string;
  scope: "selection" | "whole";
  count: number;
}

export function ReplyComposer({
  init,
  accounts,
  aiConfigured,
  onSent,
  onClose,
  onNeedsReauth,
  onSavedDraft,
  minimized,
  onMinimize,
  onRestore,
}: {
  /** Prepared initial state (kind/mode/recipients/subject/body) — compose.ts. */
  init: ComposeInit;
  /** Configured accounts — for the 送信元 display and (multi-account) picker. */
  accounts: AccountInfo[];
  aiConfigured: boolean;
  onSent: (kind: "sent" | "scheduled") => void;
  onClose: () => void;
  /** Auth expired mid-send → open 接続設定 so the user can re-auth. */
  onNeedsReauth: () => void;
  /** Draft saved locally → parent closes the composer and refreshes the count. */
  onSavedDraft: () => void;
  /** Minimized to a bottom-right dock (kept mounted so the draft is preserved). */
  minimized?: boolean;
  onMinimize?: () => void;
  onRestore?: () => void;
}) {
  const { t } = useI18n();
  // Which account to send from. Defaults to the conversation's account (reply)
  // or the active account (new mail); user can switch when 2+ are configured.
  const [account, setAccount] = useState<string | undefined>(
    init.account ?? accounts[0]?.key,
  );
  // Switching account on a reply means it can't join the original Gmail/IMAP
  // thread (threadId is account-specific) — it goes out as a fresh message.
  const accountChanged = Boolean(init.threadId) && account !== init.account;
  const fromAccount = accounts.find((a) => a.key === account);
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
  // Persistent send error (draft is kept) — clearer than a transient alert
  // for the「送ったつもりが送れてない」problem.
  const [sendError, setSendError] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [confirm, setConfirm] = useState<{
    from: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    attachmentCount: number;
    warnings: string[];
  } | null>(null);
  const [subjectBusy, setSubjectBusy] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>(init.attachments ?? []);
  const [dragging, setDragging] = useState(false);
  // HTML送信: default on when replying to an HTML mail or reopening an HTML draft.
  const [htmlSend, setHtmlSend] = useState<boolean>(Boolean(init.html || init.source?.html));
  // リッチ編集モード: rich HTML editor with inline images (opt-in). 添削 stays in
  // the plain editor; rich mode implies HTML send.
  const [richMode, setRichMode] = useState(false);
  const [richText, setRichText] = useState("");
  const [richSeed, setRichSeed] = useState<string | null>(null);
  // AI whole-message proposal for rich mode (preview → apply, no inline diff).
  const [richProposal, setRichProposal] = useState<string | null>(null);
  const richEditorRef = useRef<RichEditorHandle>(null);
  const editorRef = useRef<DraftEditorHandle>(null);
  // In-flight AI request — 中止 button aborts it (initial draft / suggest).
  const abortRef = useRef<AbortController | null>(null);
  // 指示入力の送信キー（Enter送信 ⇄ Shift+Enter送信）。端末に保存。
  const [enterToSend, setEnterToSend] = useState(loadEnterSend);
  const toggleEnterSend = () =>
    setEnterToSend((v) => {
      const next = !v;
      try {
        localStorage.setItem(ENTER_SEND_KEY, next ? "1" : "0");
      } catch {
        /* private mode — preference just won't stick */
      }
      return next;
    });

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
              ? t("composer.ai.forwardIntro")
              : undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (data.draft) {
          if (isForward) {
            // Keep the Fwd: subject; the AI note sits above the quote block.
            setInitialDraft(`${data.draft.body.trim()}\n${init.body}`);
          } else {
            setSubject(data.draft.subject);
            setInitialDraft(withQuote(data.draft.body));
          }
        } else {
          // AI生成が失敗（クレジット切れ等で500）でも、引用付きの定型文を必ず
          // 用意して手書きできるようにする（引用が消える問題の修正）。
          setInitialDraft(isForward ? init.body : withQuote(init.body));
          if (data.error) setNote(t("composer.toast.genFailed"));
        }
      } catch (e) {
        // Cancelled or failed → fall back to the plain template (editable).
        if (active) {
          setInitialDraft(isForward ? init.body : withQuote(init.body));
          if ((e as Error).name === "AbortError") setNote(t("composer.toast.genCancelled"));
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

  /**
   * Rich-mode 添削: whole-message only. Sends the plain-text projection to the
   * AI and shows the revision as a proposal (preview → 適用). Applying replaces
   * the body text (formatting/images are simplified — there's no inline diff
   * for rich content).
   */
  async function runSuggestRich(instruction: string) {
    const current = richEditorRef.current?.getText() ?? richText;
    if (!current.trim()) {
      setNote(t("composer.toast.noBody"));
      return;
    }
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
        body: JSON.stringify({ email: init.source, draft: current, instruction, subject }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t("composer.toast.suggestFailed"));
      const revised: string = data.revised ?? current;
      if (typeof data.subject === "string" && data.subject && !subject.trim()) {
        setSubject(data.subject);
      }
      const changed = revised.trim() !== current.trim();
      setHistory((h) => [...h, { id: `t${h.length}`, instruction, scope: "whole", count: changed ? 1 : 0 }]);
      if (!changed) setNote(data.ai === false ? t("composer.toast.noKeyNoChange") : t("composer.toast.noChange"));
      else setRichProposal(revised);
    } catch (e) {
      setNote(
        (e as Error).name === "AbortError" ? t("composer.toast.suggestCancelled") : t("composer.toast.suggestFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  /** Apply the rich-mode proposal: replace the body with the revised text. */
  function applyRichProposal() {
    if (richProposal == null) return;
    const hasImg = (richEditorRef.current?.getHtml() ?? "").includes("<img");
    if (hasImg && !window.confirm(t("composer.confirm.simplify"))) return;
    richEditorRef.current?.setHtml(wrapHtmlBody(plainTextToHtml(richProposal)));
    setRichText(richProposal);
    setRichProposal(null);
  }

  async function runSuggest(instruction: string, scope: "selection" | "whole") {
    if (!instruction.trim() || busy || reviewing) return;
    if (richMode) {
      void runSuggestRich(instruction);
      return;
    }
    const sel = scope === "selection" && selectionText ? selectionText : null;
    // 添削は「自分が書いた文章」だけが対象。引用文(>付きの元メール)は切り離し、
    // AIには head（自分の本文）だけ渡して、返ってきたら引用文を末尾に戻す。
    const { head, tail } = splitQuotedDraft(body, init.quote ?? "");
    // 選択範囲が引用文の中なら、添削しない（自分の文章を選ぶよう促す）。
    if (sel && tail && !head.includes(sel)) {
      setNote(t("composer.toast.quoteNoEdit"));
      return;
    }
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
          draft: head,
          instruction,
          selection: sel ? { start: 0, end: 0, text: sel } : undefined,
          subject, // blank → the AI proposes one alongside the revision
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t("composer.toast.suggestFailed"));
      const revisedHead: string = data.revised ?? head;
      // 引用文をそのまま末尾に再結合（AIは引用文に一切触れていない）。
      const revised: string = tail
        ? `${revisedHead.replace(/\s+$/, "")}\n\n${tail}`
        : revisedHead;
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
            ? t("composer.toast.noKeyNoChange")
            : proposedSubject
              ? t("composer.toast.subjectSuggested")
              : t("composer.toast.noChange"),
        );
      } else {
        if (proposedSubject) setNote(t("composer.toast.subjectAlsoSuggested"));
        editorRef.current?.loadReview(segs);
      }
    } catch (e) {
      setNote(
        (e as Error).name === "AbortError"
          ? t("composer.toast.suggestCancelled")
          : `${t("composer.toast.suggestFailed")}${(e as Error).message && (e as Error).message !== t("composer.toast.suggestFailed") ? `: ${(e as Error).message}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Build the HTML alternative from the current plain body (§A: plain authoring
   * → HTML on send). New text is escaped+linkified; for replies the original's
   * real HTML is preserved in a <blockquote> (sanitized), else the plain quote
   * is escaped. Returns undefined when HTML送信 is off.
   */
  function buildHtml(): string | undefined {
    if (!htmlSend) return undefined;
    const { head, tail } = splitQuotedDraft(body, init.quote ?? "");
    const headHtml = plainTextToHtml(head || body);
    let quoteHtml = "";
    if (init.quote) {
      if (init.source?.html) {
        quoteHtml = quoteBlock(DOMPurify.sanitize(init.source.html));
      } else if (tail) {
        quoteHtml = quoteBlock(plainTextToHtml(tail));
      }
    }
    return wrapHtmlBody(quoteHtml ? `${headHtml}<br>${quoteHtml}` : headHtml);
  }

  /** Generate a subject from the current body on demand (AI, PII-masked). */
  async function generateSubject() {
    const text = richMode ? (richEditorRef.current?.getText() ?? richText) : body;
    if (!text.trim() || subjectBusy) return;
    setSubjectBusy(true);
    setSendError(null);
    try {
      const res = await fetch("/api/ai/subject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.subject) setSubject(data.subject);
      else setSendError(data.error ?? t("composer.toast.subjectFailed"));
    } catch {
      setSendError(t("composer.toast.subjectFailed"));
    } finally {
      setSubjectBusy(false);
    }
  }

  /** Enter/leave リッチ編集. Entering seeds the rich editor from the plain body;
   *  leaving brings the text back (inline images are dropped). */
  function toggleRichMode() {
    if (!richMode) {
      setRichSeed(wrapHtmlBody(plainTextToHtml(body)));
      setHtmlSend(true);
      setRichMode(true);
    } else {
      const text = richEditorRef.current?.getText() ?? richText;
      setBody(text);
      setInitialDraft(text);
      setRichMode(false);
    }
  }

  /** Outgoing message built from the editable recipient fields. */
  function outgoing() {
    // Threading is account-specific: only carry it when sending from the
    // conversation's original account (switching account ⇒ fresh message).
    const sameAccount = account === init.account;
    const common = {
      to: parseAddressList(recipients.to),
      cc: parseAddressList(recipients.cc),
      bcc: parseAddressList(recipients.bcc),
      subject,
      inReplyTo: sameAccount ? init.inReplyTo : undefined,
      threadId: sameAccount ? init.threadId : undefined,
      account, // chosen 送信元（既定は会話の元アカウント / 新規はアクティブ）
    };
    if (richMode) {
      // Rich mode: html from the editor, inline images extracted to cid parts.
      const rawHtml = richEditorRef.current?.getHtml() ?? richSeed ?? "";
      const text = richEditorRef.current?.getText() ?? richText;
      const { html: htmlWithCids, inline } = extractInlineImages(rawHtml);
      const all = [...attachments, ...inline];
      return {
        ...common,
        body: text,
        html: wrapHtmlBody(htmlWithCids),
        attachments: all.length ? all : undefined,
      };
    }
    return {
      ...common,
      body,
      html: buildHtml(),
      attachments: attachments.length ? attachments : undefined,
    };
  }

  /** Add picked/dropped files as attachments, enforcing the total size cap. */
  async function addFiles(files: FileList | File[]) {
    setSendError(null);
    try {
      const added = await Promise.all(Array.from(files).map(fileToOutgoingAttachment));
      const next = [...attachments, ...added];
      if (totalAttachmentBytes(next) > ATTACHMENT_TOTAL_CAP) {
        setSendError(
          `${t("composer.attachOverCap.pre")}${formatBytes(ATTACHMENT_TOTAL_CAP)}${t("composer.attachOverCap.post")}`,
        );
        return;
      }
      setAttachments(next);
    } catch {
      setSendError(t("composer.toast.fileReadFailed"));
    }
  }

  const removeAttachment = (i: number) =>
    setAttachments((prev) => prev.filter((_, idx) => idx !== i));

  /** Remove the saved draft once it's been sent/scheduled (best-effort). */
  async function discardSavedDraft() {
    if (!init.draftId) return;
    try {
      await fetch(`/api/drafts/${encodeURIComponent(init.draftId)}`, { method: "DELETE" });
    } catch {
      /* leftover draft is harmless; user can delete it manually */
    }
  }

  /** Save the current draft locally (.data) without sending. */
  async function saveDraft() {
    setSavingDraft(true);
    setSendError(null);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: init.draftId, ...outgoing() }),
      });
      if (!res.ok) {
        setSendError(t("composer.toast.draftSaveFailed"));
        setSavingDraft(false);
        return;
      }
      onSavedDraft();
    } catch {
      setSendError(t("composer.toast.draftSaveFailed"));
      setSavingDraft(false);
    }
  }

  /** Build the pre-send summary + warnings and open the confirm dialog. */
  function openConfirm() {
    const msg = outgoing(); // reads editor refs — fine in an event handler
    // Only inspect the user's own writing (head), not the quoted history —
    // otherwise every reply quoting a mail about 添付 would false-warn.
    const head = splitQuotedDraft(msg.body, init.quote ?? "").head;
    const attachmentCount = msg.attachments?.length ?? 0;
    const warnings: string[] = [];
    if (!subject.trim()) warnings.push(t("composer.toast.subjectEmpty"));
    if (/添付|attach/i.test(head) && attachmentCount === 0) {
      warnings.push(t("composer.toast.attachMentionNoFile"));
    }
    setConfirm({
      from: fromAccount?.address
        ? `${fromAccount.label}：${fromAccount.address}`
        : (fromAccount?.label ?? account ?? ""),
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject,
      attachmentCount,
      warnings,
    });
  }

  async function sendNow() {
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(outgoing()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 送信失敗は下書きを残したまま赤バナーで明示（消えるalertにしない）。
        setSendError(data.error ?? t("composer.toast.sendFailed"));
        if (data.needsReauth) onNeedsReauth(); // 接続設定を開いて再認証へ
        setSending(false);
        return;
      }
      // 送信自体は成功したが控えの保存等に失敗 — 黙殺せず必ず知らせる。
      if (data.warning) alert(data.warning);
      await discardSavedDraft(); // 送れたら下書きは消す
      onSent("sent");
    } catch {
      setSendError(t("composer.toast.sendFailedNet"));
      setSending(false);
    }
  }

  async function schedule(iso: string) {
    setShowSchedule(false);
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: outgoing(), sendAt: iso }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(data.error ?? t("composer.toast.scheduleFailed"));
        if (data.needsReauth) onNeedsReauth();
        setSending(false);
        return;
      }
      await discardSavedDraft(); // 予約できたら下書きは消す
      onSent("scheduled");
    } catch {
      setSendError(t("composer.toast.scheduleFailedNet"));
      setSending(false);
    }
  }

  const effectiveBody = richMode ? richText : body;

  const canSend =
    !sending &&
    !generating &&
    !busy &&
    !reviewing &&
    !!effectiveBody.trim() &&
    // 件名は空でも送信可（メールの標準）。宛先と本文があれば送れる。
    looksLikeAddressList(recipients.to);

  // Save is allowed with partial content (the whole point of a draft).
  const canSaveDraft =
    !sending &&
    !savingDraft &&
    !generating &&
    !busy &&
    !reviewing &&
    (!!effectiveBody.trim() || !!subject.trim() || !!recipients.to.trim());

  return (
    <div
      className={
        minimized
          ? "fixed bottom-4 right-4 z-40 flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow)]"
          : "flex flex-1 overflow-hidden bg-bg"
      }
    >
      {minimized && (
        <div className="flex items-center gap-2 px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {subject.trim() || composeTitle(init)}
          </span>
          <button
            onClick={onRestore}
            title={t("composer.restore")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <Maximize2 className="size-4" />
          </button>
          <button
            onClick={onClose}
            title={t("composer.discardClose")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      {/* Kept mounted even when minimized (hidden) so the draft is never lost. */}
      <div className={minimized ? "hidden" : "flex flex-1 overflow-hidden"}>
        {/* Draft editor */}
        <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-surface px-5 py-3">
          <h2 className="shrink-0 text-sm font-semibold">{composeTitle(init)}</h2>
          {accounts.length > 0 && (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
              <span className="shrink-0">{t("composer.from")}</span>
              {accounts.length > 1 ? (
                <select
                  value={account ?? ""}
                  onChange={(e) => setAccount(e.target.value)}
                  disabled={sending}
                  className="min-w-0 rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-fg outline-none focus:border-accent"
                >
                  {accounts.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.address ? `${a.label}：${a.address}` : a.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="truncate font-medium text-fg">
                  {fromAccount?.address
                    ? `${fromAccount.label}：${fromAccount.address}`
                    : (fromAccount?.label ?? account)}
                </span>
              )}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onMinimize && (
              <button
                onClick={onMinimize}
                title={t("composer.minimize")}
                className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
              >
                <Minimize2 className="size-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        {accountChanged && (
          <div className="border-b border-border bg-amber-500/10 px-5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            {t("composer.accountChangedWarn")}
          </div>
        )}

        <div
          className="relative flex flex-1 flex-col overflow-hidden px-6 py-4"
          onDragOver={(e) => {
            if (richMode) return; // rich editor handles image drops itself
            // Only react to FILE drags — a contact/text drag must not trigger the
            // 「ここにドロップして添付」overlay（連絡先ドラッグで誤表示しない）。
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            if (!dragging) setDragging(true);
          }}
          onDragLeave={(e) => {
            if (richMode) return;
            // Only clear when the pointer actually leaves the composer body.
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={(e) => {
            if (richMode) return;
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
          }}
        >
          {dragging && !richMode && (
            <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-medium text-accent">
              {t("composer.dropToAttach")}
            </div>
          )}
          <RecipientFields values={recipients} onChange={setRecipients} disabled={sending} />
          <div className="mt-1.5 flex items-center gap-2 border-b border-border pb-2">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("composer.subjectPlaceholder")}
              className="w-full bg-transparent text-base font-medium outline-none placeholder:text-fg-subtle"
            />
            <button
              type="button"
              onClick={generateSubject}
              disabled={subjectBusy || sending}
              title={t("composer.subjectAiTitle")}
              className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {subjectBusy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              {t("composer.subjectAi")}
            </button>
          </div>

          {/* Selection action bar (plain editor only). Floated (absolute) so it
              never reflows the editor — an in-flow bar shifted the editor down
              mid-drag, making mouse/shift-click selection grab the wrong text. */}
          {selectionText && !reviewing && !generating && !richMode && (
            <div className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-3rem)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs shadow-lg animate-in">
              <Wand2 className="size-3.5 text-accent" />
              <span className="text-accent">{t("composer.selectionEdit")}</span>
              {(["composer.chip.polite", "composer.chip.shorter", "composer.chip.rephrase"] as const).map(
                (key) => {
                  const p = t(key);
                  return (
                    <button
                      key={key}
                      onClick={() => runSuggest(p, "selection")}
                      className="rounded-full border border-accent/40 bg-surface px-2 py-0.5 text-fg-muted hover:text-accent"
                    >
                      {p}
                    </button>
                  );
                },
              )}
              <span className="text-fg-subtle">{t("composer.orInstructRight")}</span>
            </div>
          )}

          <div className="relative mt-3 flex-1 overflow-y-auto">
            {richMode ? (
              <RichEditor
                ref={richEditorRef}
                loadHtml={richSeed}
                onChange={({ text }) => setRichText(text)}
              />
            ) : (
              <DraftEditor
                ref={editorRef}
                loadText={initialDraft}
                onChange={({ text, pending }) => {
                  setBody(text);
                  setPending(pending);
                }}
                onSelectionChange={setSelectionText}
              />
            )}
            {generating && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg text-fg-subtle">
                <Loader2 className="size-5 animate-spin text-accent" />
                <p className="text-sm">{t("composer.aiDrafting")}</p>
                <button
                  onClick={cancelAi}
                  className="mt-1 rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-high hover:text-high"
                >
                  {t("composer.cancelWriteSelf")}
                </button>
              </div>
            )}
            {busy && (
              <div className="absolute right-2 top-0 flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent">
                <Loader2 className="size-3 animate-spin" /> {t("composer.makingSuggestion")}
                <button
                  onClick={cancelAi}
                  title={t("composer.cancelGen")}
                  className="rounded-full px-1.5 font-medium underline-offset-2 hover:underline"
                >
                  {t("composer.cancelShort")}
                </button>
              </div>
            )}
          </div>
        </div>

        {sendError && (
          <div className="flex items-start gap-2 border-t border-red-500/30 bg-red-500/10 px-6 py-2 text-xs text-red-700 dark:text-red-400">
            <span className="flex-1">{t("composer.sendErrorPrefix")} {sendError}</span>
            <button
              onClick={() => setSendError(null)}
              className="shrink-0 rounded px-1.5 underline-offset-2 hover:underline"
            >
              {t("composer.close")}
            </button>
          </div>
        )}
        {/* Review bar OR send controls */}
        {reviewing ? (
          <div className="flex items-center gap-2 border-t border-border bg-surface px-6 py-3">
            <span className="text-sm font-medium text-accent">{pending}{t("composer.reviewCountSuffix")}</span>
            <span className="text-xs text-fg-subtle">
              {t("composer.reviewLegend")}<strong>{t("composer.mustResolveAll")}</strong>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => editorRef.current?.resolveAll("before")}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2"
              >
                {t("composer.rejectAll")}
              </button>
              <button
                onClick={() => editorRef.current?.resolveAll("after")}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
              >
                <CheckCheck className="size-4" />
                {t("composer.acceptAll")}
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-border bg-surface">
            {(attachments.length > 0 || richMode) && (
              <div className="flex flex-wrap items-center gap-2 px-6 pt-2.5">
                <AttachmentChips items={attachments} onRemove={removeAttachment} disabled={sending} />
                {richMode && (
                  <span className="text-[11px] text-fg-subtle">
                    {t("composer.richModeHint")}
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-nowrap items-center gap-1.5 px-6 py-3">
              {/* ① 作成オプション（脇役はアイコンのみ・状態は色で） */}
              <AttachmentButton onAdd={addFiles} disabled={sending} />
              {!richMode && (
                <button
                  type="button"
                  onClick={() => setHtmlSend((v) => !v)}
                  disabled={sending}
                  title={`${t("composer.htmlSend.title")}${htmlSend ? t("composer.on") : t("composer.off")}`}
                  className={`grid size-9 shrink-0 place-items-center rounded-lg border transition-colors disabled:opacity-50 ${
                    htmlSend
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-fg-muted hover:border-accent hover:text-accent"
                  }`}
                >
                  <Code2 className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={toggleRichMode}
                disabled={sending}
                title={`${t("composer.rich.title")}${richMode ? t("composer.on") : t("composer.off")}`}
                className={`grid size-9 shrink-0 place-items-center rounded-lg border transition-colors disabled:opacity-50 ${
                  richMode
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-fg-muted hover:border-accent hover:text-accent"
                }`}
              >
                <ImageIcon className="size-4" />
              </button>

              <div className="mx-1 h-6 w-px bg-border" />

              {/* ② 主役: 送信 */}
              <button
                onClick={openConfirm}
                disabled={!canSend}
                className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {t("composer.sendNow")}
              </button>
              <button
                onClick={() => setShowSchedule(true)}
                disabled={!canSend}
                title={t("composer.scheduleTitle")}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                <Clock className="size-4" />
                {t("composer.scheduleShort")}
              </button>

              {/* ③ 下書き / 破棄（右寄せ） */}
              <button
                onClick={saveDraft}
                disabled={!canSaveDraft}
                title={t("composer.saveDraft.title")}
                className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {savingDraft ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {t("composer.saveDraft")}
              </button>
              <button
                onClick={onClose}
                title={t("composer.discard")}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-high"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AI assistant rail */}
      <div className="flex w-[400px] max-w-[42vw] shrink-0 flex-col border-l border-border bg-surface-2">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="grid size-6 place-items-center rounded-md bg-accent text-accent-fg">
            <Sparkles className="size-3.5" />
          </div>
          <span className="text-sm font-semibold">{t("composer.aiAssistant")}</span>
          {!aiConfigured && <span className="ml-auto text-[10px] text-fg-subtle">{t("composer.basicMode")}</span>}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {richMode && richProposal != null && (
            <div className="space-y-2 rounded-xl border border-accent/40 bg-accent-soft/40 p-3">
              <p className="text-xs font-medium text-accent">{t("composer.aiSuggestionWhole")}</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface p-2.5 text-[13px] leading-6 text-fg/90">
                {richProposal}
              </pre>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={applyRichProposal}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
                >
                  <CheckCheck className="size-3.5" />
                  {t("composer.apply")}
                </button>
                <button
                  onClick={() => setRichProposal(null)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-2"
                >
                  {t("composer.reject")}
                </button>
                <span className="text-[10px] text-fg-subtle">{t("composer.applyReplace")}</span>
              </div>
            </div>
          )}
          <p className="rounded-xl bg-surface px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
            {richMode
              ? t("composer.railHintRich")
              : t("composer.railHintPlain")}
          </p>

          {history.map((h) => (
            <div key={h.id} className="space-y-1">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm text-accent-fg">
                  {h.scope === "selection" && (
                    <span className="mr-1 rounded bg-white/20 px-1 text-[10px]">{t("composer.scopeRange")}</span>
                  )}
                  {h.instruction}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
                <Check className="size-3" />
                {h.count > 0 ? `${h.count}${t("composer.suggestionsMadeSuffix")}` : t("composer.noChangeShort")}
              </div>
            </div>
          ))}
          {note && <div className="text-xs text-fg-subtle">{note}</div>}
          {busy && (
            <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <Loader2 className="size-3 animate-spin" /> {t("composer.thinking")}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-2.5">
          {QUICK_PROMPT_KEYS.map((key) => {
            const p = t(key);
            return (
              <button
                key={key}
                onClick={() => runSuggest(p, "whole")}
                disabled={busy || generating || reviewing}
                className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {p}
              </button>
            );
          })}
        </div>

        <div className="border-t border-border p-3">
          <div className="mb-1.5 flex items-center justify-end">
            <label className="flex cursor-pointer items-center gap-1 text-[10px] text-fg-subtle">
              <input
                type="checkbox"
                checked={enterToSend}
                onChange={toggleEnterSend}
                className="size-3 accent-[var(--accent)]"
              />
              {t("composer.enterToSendLabel")}
            </label>
          </div>
          <div className="flex items-end gap-2 rounded-xl border border-border bg-surface px-3 py-2 focus-within:border-accent">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                // Never fire while the IME is composing (Japanese input:
                // the conversion-confirm Enter must not send).
                if (e.nativeEvent.isComposing) return;
                // enterToSend: Enter=送信 / Shift+Enter=改行。
                // 既定: Shift/Cmd/Ctrl+Enter=送信 / Enter=改行。
                const send = enterToSend
                  ? !e.shiftKey
                  : e.shiftKey || e.metaKey || e.ctrlKey;
                if (send) {
                  e.preventDefault();
                  runSuggest(input, selectionText ? "selection" : "whole");
                }
              }}
              rows={3}
              placeholder={
                (richMode
                  ? t("composer.instructWholeExample")
                  : selectionText
                    ? t("composer.instructSelection")
                    : t("composer.instructWhole")) +
                (enterToSend ? t("composer.enterHintSend") : t("composer.enterHintShift"))
              }
              disabled={reviewing}
              className="max-h-48 min-h-[4.5rem] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-fg-subtle disabled:opacity-50"
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
      </div>

      {showSchedule && (
        <ScheduleDialog onSchedule={schedule} onClose={() => setShowSchedule(false)} />
      )}
      {confirm && (
        <SendConfirmDialog
          {...confirm}
          sending={sending}
          onConfirm={() => {
            setConfirm(null);
            void sendNow();
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
