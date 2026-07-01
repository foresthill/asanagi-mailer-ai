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
} from "lucide-react";
import { ScheduleDialog } from "./ScheduleDialog";
import { SendConfirmDialog } from "./SendConfirmDialog";
import DOMPurify from "dompurify";
import { AttachmentButton, AttachmentChips, fileToOutgoingAttachment } from "./AttachmentBar";
import { ATTACHMENT_TOTAL_CAP, totalAttachmentBytes } from "@/lib/attachments";
import { plainTextToHtml, wrapHtmlBody, quoteBlock, extractInlineImages } from "@/lib/html-mail";
import { formatBytes } from "./StorageMeter";
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

const QUICK_PROMPTS = ["もっと丁寧に", "もっと短く", "カジュアルに", "英語にして", "感謝を加えて"];

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
}) {
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
          if (data.error) setNote("AIの下書きを生成できませんでした。引用はそのまま、手書きでどうぞ。");
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

  /**
   * Rich-mode 添削: whole-message only. Sends the plain-text projection to the
   * AI and shows the revision as a proposal (preview → 適用). Applying replaces
   * the body text (formatting/images are simplified — there's no inline diff
   * for rich content).
   */
  async function runSuggestRich(instruction: string) {
    const current = richEditorRef.current?.getText() ?? richText;
    if (!current.trim()) {
      setNote("本文がありません");
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
      if (!res.ok) throw new Error(data.error ?? "提案の生成に失敗しました");
      const revised: string = data.revised ?? current;
      if (typeof data.subject === "string" && data.subject && !subject.trim()) {
        setSubject(data.subject);
      }
      const changed = revised.trim() !== current.trim();
      setHistory((h) => [...h, { id: `t${h.length}`, instruction, scope: "whole", count: changed ? 1 : 0 }]);
      if (!changed) setNote(data.ai === false ? "AIキー未設定のため変更なし" : "変更はありませんでした");
      else setRichProposal(revised);
    } catch (e) {
      setNote(
        (e as Error).name === "AbortError" ? "提案を中止しました" : "提案の生成に失敗しました",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Apply the rich-mode proposal: replace the body with the revised text. */
  function applyRichProposal() {
    if (richProposal == null) return;
    const hasImg = (richEditorRef.current?.getHtml() ?? "").includes("<img");
    if (hasImg && !window.confirm("画像と書式は簡素化されます。AIの提案を適用しますか？")) return;
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
      setNote("引用部分は添削できません（自分が書いた文章を選択してください）");
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
      if (!res.ok) throw new Error(data.error ?? "提案の生成に失敗しました");
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
      setNote(
        (e as Error).name === "AbortError"
          ? "提案を中止しました"
          : `提案の生成に失敗しました${(e as Error).message && (e as Error).message !== "提案の生成に失敗しました" ? `: ${(e as Error).message}` : ""}`,
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
      else setSendError(data.error ?? "件名の生成に失敗しました");
    } catch {
      setSendError("件名の生成に失敗しました");
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
        setSendError(`添付の合計が上限(${formatBytes(ATTACHMENT_TOTAL_CAP)})を超えます`);
        return;
      }
      setAttachments(next);
    } catch {
      setSendError("ファイルの読み込みに失敗しました");
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
        setSendError("下書きの保存に失敗しました");
        setSavingDraft(false);
        return;
      }
      onSavedDraft();
    } catch {
      setSendError("下書きの保存に失敗しました");
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
    if (!subject.trim()) warnings.push("件名が空です");
    if (/添付|attach/i.test(head) && attachmentCount === 0) {
      warnings.push("本文に「添付」とありますが、添付ファイルがありません");
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
        setSendError(data.error ?? "送信に失敗しました");
        if (data.needsReauth) onNeedsReauth(); // 接続設定を開いて再認証へ
        setSending(false);
        return;
      }
      // 送信自体は成功したが控えの保存等に失敗 — 黙殺せず必ず知らせる。
      if (data.warning) alert(data.warning);
      await discardSavedDraft(); // 送れたら下書きは消す
      onSent("sent");
    } catch {
      setSendError("送信に失敗しました（ネットワークを確認してください）");
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
        setSendError(data.error ?? "予約に失敗しました");
        if (data.needsReauth) onNeedsReauth();
        setSending(false);
        return;
      }
      await discardSavedDraft(); // 予約できたら下書きは消す
      onSent("scheduled");
    } catch {
      setSendError("予約に失敗しました（ネットワークを確認してください）");
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
    <div className="flex flex-1 overflow-hidden bg-bg">
      {/* Draft editor */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-surface px-5 py-3">
          <h2 className="shrink-0 text-sm font-semibold">{composeTitle(init)}</h2>
          {accounts.length > 0 && (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
              <span className="shrink-0">送信元:</span>
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
          <button
            onClick={onClose}
            className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>
        {accountChanged && (
          <div className="border-b border-border bg-amber-500/10 px-5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            別アカウントから送るため、このメールは元のスレッドには連なりません（新規メール扱い）。
          </div>
        )}

        <div
          className="relative flex flex-1 flex-col overflow-hidden px-6 py-4"
          onDragOver={(e) => {
            if (richMode) return; // rich editor handles image drops itself
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
              ここにドロップして添付
            </div>
          )}
          <RecipientFields values={recipients} onChange={setRecipients} disabled={sending} />
          <div className="mt-1.5 flex items-center gap-2 border-b border-border pb-2">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="件名（空でも送信できます）"
              className="w-full bg-transparent text-base font-medium outline-none placeholder:text-fg-subtle"
            />
            <button
              type="button"
              onClick={generateSubject}
              disabled={subjectBusy || sending}
              title="本文からAIで件名を生成"
              className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {subjectBusy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              件名AI
            </button>
          </div>

          {/* Selection action bar (plain editor only). Floated (absolute) so it
              never reflows the editor — an in-flow bar shifted the editor down
              mid-drag, making mouse/shift-click selection grab the wrong text. */}
          {selectionText && !reviewing && !generating && !richMode && (
            <div className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-3rem)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs shadow-lg animate-in">
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

        {sendError && (
          <div className="flex items-start gap-2 border-t border-red-500/30 bg-red-500/10 px-6 py-2 text-xs text-red-700 dark:text-red-400">
            <span className="flex-1">送信できませんでした: {sendError}</span>
            <button
              onClick={() => setSendError(null)}
              className="shrink-0 rounded px-1.5 underline-offset-2 hover:underline"
            >
              閉じる
            </button>
          </div>
        )}
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
          <div className="border-t border-border bg-surface">
            {(attachments.length > 0 || richMode) && (
              <div className="flex flex-wrap items-center gap-2 px-6 pt-2.5">
                <AttachmentChips items={attachments} onRemove={removeAttachment} disabled={sending} />
                {richMode && (
                  <span className="text-[11px] text-fg-subtle">
                    画像は貼り付け/ドロップで挿入・HTML送信。AI添削は全体提案（右で指示→適用）
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
                  title={`HTML形式で送信（書式・元メールのHTML引用を保持）: ${htmlSend ? "オン" : "オフ"}`}
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
                title={`リッチ編集（画像の貼り付け・ドロップで挿入・HTML送信）: ${richMode ? "オン" : "オフ"}`}
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
                今すぐ送信
              </button>
              <button
                onClick={() => setShowSchedule(true)}
                disabled={!canSend}
                title="予約送信"
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                <Clock className="size-4" />
                予約
              </button>

              {/* ③ 下書き / 破棄（右寄せ） */}
              <button
                onClick={saveDraft}
                disabled={!canSaveDraft}
                title="送らずに下書きとして保存（端末内のみ）"
                className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {savingDraft ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                下書き保存
              </button>
              <button
                onClick={onClose}
                title="破棄"
                className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-high"
              >
                <X className="size-4" />
              </button>
            </div>
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
          {richMode && richProposal != null && (
            <div className="space-y-2 rounded-xl border border-accent/40 bg-accent-soft/40 p-3">
              <p className="text-xs font-medium text-accent">AIの提案（全体）</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface p-2.5 text-[13px] leading-6 text-fg/90">
                {richProposal}
              </pre>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={applyRichProposal}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
                >
                  <CheckCheck className="size-3.5" />
                  適用
                </button>
                <button
                  onClick={() => setRichProposal(null)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-2"
                >
                  却下
                </button>
                <span className="text-[10px] text-fg-subtle">適用で本文を差し替え（書式・画像は簡素化）</span>
              </div>
            </div>
          )}
          <p className="rounded-xl bg-surface px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
            {richMode
              ? "リッチ編集中は下の入力で全体に指示できます（例: もっと丁寧に）。提案を確認して「適用」で本文に反映されます。"
              : "本文を範囲選択して「ここをこうして」と指示するか、下の入力で全体に指示できます。提案は一箇所ずつ採用/却下できます。"}
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
                richMode
                  ? "全体への指示（例: もっと丁寧に）→ 提案を確認して適用"
                  : (selectionText ? "選択範囲への指示" : "全体への指示") + "（Shift+Enterで送信）"
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
