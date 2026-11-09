"use client";

import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { WritingSample } from "@/lib/types";

/**
 * 返信文体の昇格UI（個人的無意識 B）。AIの下書きと、ユーザーが実際に送った
 * 自筆の差分（教師データ）を並べ、ユーザーが選んだものだけ「文体ルール」に
 * 昇格させる on-demand pull 型。LLMは差分からルールを1行"提案"するだけで、
 * 保存はユーザーが編集・承認してから（自動抽出・自動上書きはしない）。
 */
export function WritingSamplesSection() {
  const { t } = useI18n();
  const [items, setItems] = useState<WritingSample[] | null>(null);
  // Per-sample inline rule editor keyed by the sample's `at`.
  const [edit, setEdit] = useState<{ at: string; rule: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const load = async () => {
    try {
      const r = await fetch("/api/ai/writing-samples", { cache: "no-store" });
      const d = (await r.json()) as { items: WritingSample[] };
      setItems(d.items ?? []);
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    // Kick off via a timer so setState never runs synchronously in the effect
    // body (keeps react-hooks/set-state-in-effect happy).
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, []);

  // Open the rule editor for a sample, pre-filled with the AI's suggestion
  // (best-effort — a free-text box either way, so it works offline too).
  async function startRule(s: WritingSample) {
    setEdit({ at: s.at, rule: "" });
    setSuggesting(true);
    try {
      const r = await fetch("/api/ai/writing-rule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ai: s.ai, final: s.final }),
      });
      const d = (await r.json()) as { rule?: string };
      setEdit((cur) => (cur && cur.at === s.at ? { ...cur, rule: d.rule ?? "" } : cur));
    } catch {
      /* leave the box empty — the user writes their own rule */
    } finally {
      setSuggesting(false);
    }
  }

  // Append the approved rule to writing-note (never overwrite), then drop the
  // sample from the list.
  async function addRule(at: string, rule: string) {
    const line = rule.trim();
    if (!line) return;
    setSaving(true);
    try {
      const cur = await fetch("/api/ai/writing-note")
        .then((r) => r.json())
        .then((d: { note?: string }) => (d.note ?? "").trim())
        .catch(() => "");
      const next = cur ? `${cur}\n${line}` : line;
      await fetch("/api/ai/writing-note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: next }),
      });
      await dismiss(at);
      setEdit(null);
      flash(t("wsamp.added"));
    } catch {
      flash(t("wsamp.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function dismiss(at: string) {
    setItems((prev) => prev?.filter((x) => x.at !== at) ?? prev);
    try {
      await fetch(`/api/ai/writing-samples?at=${encodeURIComponent(at)}`, {
        method: "DELETE",
      });
    } catch {
      /* best-effort — reappears on next load if it failed */
    }
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 1800);
  }

  // Hidden until there's something to learn from (keeps settings uncluttered).
  if (items !== null && items.length === 0) return null;

  return (
    <section className="border-t border-border pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <GraduationCap className="size-4 text-accent" />
        {t("wsamp.title")}
        {toast && <span className="text-xs font-normal text-accent">{toast}</span>}
      </h3>
      <p className="mt-1 text-xs text-fg-muted">{t("wsamp.intro")}</p>

      <ul className="mt-3 space-y-2">
        {(items ?? []).map((s) => (
          <li key={s.at} className="rounded-lg border border-border bg-bg p-3">
            <div className="flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
              <span className="truncate">{s.subject || t("wsamp.noSubject")}</span>
              <span
                className={
                  s.edited
                    ? "shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-amber-600 dark:text-amber-400"
                    : "shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400"
                }
              >
                {s.edited ? t("wsamp.edited") : t("wsamp.asis")}
              </span>
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <div className="mb-0.5 text-[10px] font-medium text-fg-subtle">
                  {t("wsamp.ai")}
                </div>
                <div className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-surface px-2 py-1 text-[11px] text-fg-muted">
                  {s.ai}
                </div>
              </div>
              <div>
                <div className="mb-0.5 text-[10px] font-medium text-fg-subtle">
                  {t("wsamp.final")}
                </div>
                <div className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-surface px-2 py-1 text-[11px] text-fg">
                  {s.final}
                </div>
              </div>
            </div>

            {edit?.at === s.at ? (
              <div className="mt-2">
                <textarea
                  value={edit.rule}
                  onChange={(e) => setEdit({ at: s.at, rule: e.target.value })}
                  placeholder={
                    suggesting ? t("wsamp.suggesting") : t("wsamp.rulePlaceholder")
                  }
                  rows={2}
                  className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    onClick={() => addRule(s.at, edit.rule)}
                    disabled={saving || !edit.rule.trim()}
                    className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    {t("wsamp.add")}
                  </button>
                  <button
                    onClick={() => setEdit(null)}
                    className="rounded-md border border-border px-2.5 py-1 text-[11px] text-fg-muted transition-colors hover:bg-surface"
                  >
                    {t("wsamp.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                {s.edited && (
                  <button
                    onClick={() => startRule(s)}
                    className="rounded-md border border-border px-2.5 py-1 text-[11px] text-fg-muted transition-colors hover:bg-surface hover:text-fg"
                  >
                    {t("wsamp.toRule")}
                  </button>
                )}
                <button
                  onClick={() => dismiss(s.at)}
                  className="rounded-md px-2.5 py-1 text-[11px] text-fg-subtle transition-colors hover:text-fg"
                >
                  {t("wsamp.dismiss")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
