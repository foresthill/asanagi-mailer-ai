"use client";

import { useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import type { Email } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/**
 * 「本文の見せ方」バー。本文の冒頭に右寄せで置き、HTML/テキスト切替と翻訳を
 * 1か所に集約する（ズーム・アウトラインは常時表示が要るので上部ツールバーに残す）。
 * 翻訳は閲覧用：本文は差し替えず、下に訳文を出すだけ（元本文は不変・PIIはマスク送信）。
 */

const TRANSLATE_LANGS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
];

export function BodyViewBar({
  email,
  textMode,
  onTextMode,
  showHtmlToggle,
}: {
  email: Email;
  textMode: boolean;
  onTextMode: (v: boolean) => void;
  /** HTMLメールのとき true。テキストのみのメールでは HTML/テキスト切替を出さない。 */
  showHtmlToggle: boolean;
}) {
  const { t } = useI18n();
  const [showTr, setShowTr] = useState(false);
  const [tr, setTr] = useState<{
    lang?: string;
    loading: boolean;
    text?: string;
    error?: string;
  }>({ loading: false });

  const translate = async (code: string) => {
    setTr({ lang: code, loading: true });
    try {
      const r = await fetch("/api/ai/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: email.body || email.snippet, target: code }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? t("translate.failed"));
      setTr({ lang: code, loading: false, text: d.text });
    } catch (e) {
      setTr({
        lang: code,
        loading: false,
        error: e instanceof Error ? e.message : t("translate.failed"),
      });
    }
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {showHtmlToggle && (
          <>
            <ModeButton
              label="HTML"
              active={!textMode}
              onClick={() => onTextMode(false)}
            />
            <ModeButton
              label={t("reader.textMode")}
              active={textMode}
              onClick={() => onTextMode(true)}
            />
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          </>
        )}
        <button
          type="button"
          onClick={() => setShowTr((v) => !v)}
          aria-pressed={showTr}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
            showTr
              ? "border-accent bg-accent-soft text-accent"
              : "border-border text-fg-muted hover:border-fg-subtle hover:text-fg",
          )}
        >
          <Languages className="size-3.5" />
          <span>{t("meta.translate")}</span>
        </button>
      </div>

      {showTr && (
        <div className="mt-2 rounded-xl border border-border bg-surface px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-fg-subtle">
              {t("meta.translate")}:
            </span>
            {TRANSLATE_LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => translate(l.code)}
                disabled={tr.loading}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-60",
                  tr.lang === l.code
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-fg-muted hover:border-accent hover:text-accent",
                )}
              >
                {l.label}
              </button>
            ))}
            {tr.loading && (
              <Loader2 className="size-3.5 animate-spin text-fg-subtle" />
            )}
          </div>
          {tr.error && <p className="mt-1.5 text-[11px] text-high">{tr.error}</p>}
          {tr.text && (
            <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-fg">
              {tr.text}
            </div>
          )}
          <p className="mt-1.5 text-[10px] text-fg-subtle">
            {t("translate.note")}
          </p>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 text-[11px] transition-colors",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border text-fg-muted hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}
