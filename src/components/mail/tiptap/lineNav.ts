/**
 * macOS-style visual-line caret navigation for the compose editors.
 *
 * Ctrl+A = 行頭 / Ctrl+E = 行末 (Shift extends → selects the line). Mac users
 * expect these emacs bindings in every text field, but ProseMirror's document
 * model has no notion of a *visual* (wrapped / hardBreak-separated) line, so
 * Ctrl+A otherwise jumps to the very start of the message. We drive the native
 * DOM Selection instead, which follows visual lines. Best-effort: a no-op where
 * `Selection.modify` is unavailable (non-WebKit/Blink), so nothing breaks.
 */
type Alter = "move" | "extend";

function lineBoundary(alter: Alter, dir: "backward" | "forward"): boolean {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  const modify = (sel as (Selection & { modify?: (a: string, d: string, g: string) => void }) | null)
    ?.modify;
  if (!sel || typeof modify !== "function") return false;
  modify.call(sel, alter, dir, "lineboundary");
  return true;
}

/**
 * ProseMirror `editorProps.handleKeyDown` — returns true (handled) for the
 * Ctrl+A/E line moves so ProseMirror doesn't hijack them to doc start/end.
 */
export function handleLineNavKeyDown(_view: unknown, event: KeyboardEvent): boolean {
  // Plain Ctrl only (macOS emacs). Leave Cmd (select-all) and Alt untouched.
  if (!event.ctrlKey || event.metaKey || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key === "a") return lineBoundary(event.shiftKey ? "extend" : "move", "backward");
  if (key === "e") return lineBoundary(event.shiftKey ? "extend" : "move", "forward");
  return false;
}

/**
 * ProseMirror `editorProps.handleTripleClick` — select the VISUAL line under
 * the cursor instead of the whole (single) paragraph, which for the plain
 * DraftEditor means "select everything". Matches other mail clients where a
 * triple-click grabs one line. Returns true so ProseMirror skips its default.
 */
export function handleTripleClickLine(): boolean {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  const s = sel as
    | (Selection & { modify?: (a: string, d: string, g: string) => void })
    | null;
  if (!s || typeof s.modify !== "function") return false;
  // Collapse the word the double-click left selected → a caret on this line,
  // then grow to the line's visual start and end.
  s.collapseToStart();
  s.modify("move", "backward", "lineboundary");
  s.modify("extend", "forward", "lineboundary");
  return true;
}
