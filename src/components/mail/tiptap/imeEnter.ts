/**
 * IME-composition-aware Enter guard for the compose editors — a WKWebView fix.
 *
 * WebKit / WKWebView dispatch `compositionend` BEFORE the `keydown` that confirms
 * an IME candidate, so that Enter arrives with `isComposing === false` and
 * `keyCode === 13` — indistinguishable from a real newline Enter by the event
 * fields alone (WebKit bug 165004: https://bugs.webkit.org/show_bug.cgi?id=165004).
 * ProseMirror's keymap (or a textarea's keydown) then runs its Enter action and a
 * line break / send fires on the very Enter that was only meant to CONFIRM the
 * 変換. Native inputs & other apps don't, which is why Asanagi felt like "Enter
 * ですぐ改行が入る / 他アプリと違う" during Japanese input.
 *
 * Fix: track composition ourselves and clear the flag on a DEFERRED tick
 * (setTimeout 0) after `compositionend`, so the synchronous confirming keydown
 * that follows in the same tick still sees composition as active and is treated
 * as IME-owned. The next, deliberate Enter (a separate press on a later tick)
 * behaves normally. `isComposing` / `keyCode === 229` are also honoured for
 * engines that report them correctly.
 *
 * Shared by the Tiptap editors (DraftEditor / RichEditor, via editorProps) and
 * the plain instruction <textarea> in ReplyComposer (via React handlers).
 */
export interface ImeEnterGuard {
  /** Mark composition as started (compositionstart). */
  onCompositionStart: () => void;
  /** Mark composition as ended, but keep the flag through the confirming keydown. */
  onCompositionEnd: () => void;
  /** True when this keydown is an IME-confirm Enter that must NOT act. */
  isImeConfirmEnter: (event: KeyboardEvent) => boolean;
}

export function createImeEnterGuard(): ImeEnterGuard {
  let composing = false;
  return {
    onCompositionStart() {
      composing = true;
    },
    onCompositionEnd() {
      // Clear only AFTER the confirming keydown (same tick) has been processed.
      setTimeout(() => {
        composing = false;
      }, 0);
    },
    isImeConfirmEnter(event) {
      if (event.key !== "Enter") return false;
      return composing || event.isComposing || event.keyCode === 229;
    },
  };
}
