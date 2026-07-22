"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

/**
 * Writing-style rules (文章作成メモ) injected into every AI reply/refine.
 * Separate from the importance "AIへのメモ" — this one shapes *how the AI
 * writes*, so a bad draft can be corrected once, permanently, by adding a line.
 */
export function WritingNoteSection() {
  const [note, setNote] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/ai/writing-note")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setNote(d.note ?? "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  async function save(text: string) {
    try {
      await fetch("/api/ai/writing-note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      /* best-effort — retries on next blur */
    }
  }

  return (
    <section className="border-t border-border pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="size-4 text-accent" />
        文章作成メモ（返信・添削のルール）
        {saved && <span className="text-xs font-normal text-accent">✓ 保存しました</span>}
      </h3>
      <p className="mt-1 text-xs text-fg-muted">
        AIの返信下書き・添削すべてに反映される文体ルールです。変な修正が出たら1行足すだけで次から直ります。
        <br />
        例:「絵文字は使わない」「過剰敬語にしない」「勝手に日程を確約しない」「箇条書きを多用しない」
      </p>
      <textarea
        value={loaded ? note : ""}
        onChange={(e) => setNote(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        disabled={!loaded}
        placeholder="1行に1ルール。例: 絵文字は使わない"
        rows={4}
        className="mt-3 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
      />
    </section>
  );
}
