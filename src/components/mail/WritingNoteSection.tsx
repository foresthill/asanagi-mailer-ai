"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Writing-style rules (文章作成メモ) injected into every AI reply/refine.
 * Separate from the importance "AIへのメモ" — this one shapes *how the AI
 * writes*, so a bad draft can be corrected once, permanently, by adding a line.
 */
export function WritingNoteSection() {
  const { t } = useI18n();
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
        {t("wnote.title")}
        {saved && (
          <span className="text-xs font-normal text-accent">
            {t("wnote.saved")}
          </span>
        )}
      </h3>
      <p className="mt-1 text-xs text-fg-muted">
        {t("wnote.intro")}
        <br />
        {t("wnote.example")}
      </p>
      <textarea
        value={loaded ? note : ""}
        onChange={(e) => setNote(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        disabled={!loaded}
        placeholder={t("wnote.placeholder")}
        rows={4}
        className="mt-3 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
      />
    </section>
  );
}
