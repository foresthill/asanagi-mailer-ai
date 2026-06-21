"use client";

import { useEffect, useRef, useState } from "react";
import { NotebookPen, Check, Loader2 } from "lucide-react";

/**
 * 自分用メモ — a private note attached to one email. Stored on the device only
 * (.data/notes.json) and NEVER sent to the AI. Autosaves on blur.
 */
export function PrivateNote({
  emailId,
  onSaved,
}: {
  emailId: string;
  /** Note created/cleared → let the list refresh its 📝 indicator. */
  onSaved?: () => void;
}) {
  const [text, setText] = useState<string | null>(null); // null = loading
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const lastSaved = useRef("");

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on email change
    setText(null);
    setSaved(false);
    (async () => {
      try {
        const res = await fetch(`/api/notes?id=${encodeURIComponent(emailId)}`);
        const data = await res.json();
        if (!active) return;
        setText(data.text ?? "");
        lastSaved.current = data.text ?? "";
      } catch {
        if (active) setText("");
      }
    })();
    return () => {
      active = false;
    };
  }, [emailId]);

  async function save() {
    if (text === null || text === lastSaved.current) return;
    setSaving(true);
    try {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: emailId, text }),
      });
      lastSaved.current = text;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-amber-300/40 bg-amber-50/50 px-3 py-2.5 dark:bg-amber-400/5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
        <NotebookPen className="size-3.5" />
        自分用メモ
        <span className="font-normal text-fg-subtle">（この端末だけ・AIには渡しません）</span>
        {saving && <Loader2 className="size-3 animate-spin" />}
        {saved && (
          <span className="flex items-center gap-0.5 text-emerald-600">
            <Check className="size-3" />
            保存
          </span>
        )}
      </div>
      <textarea
        value={text ?? ""}
        disabled={text === null}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        rows={2}
        placeholder="このメールの覚え書き（例: 返信は来週・請求番号 #123・要確認）。入力欄を離れると保存。"
        className="w-full resize-y bg-transparent text-sm outline-none placeholder:text-fg-subtle disabled:opacity-50"
      />
    </div>
  );
}
