"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/**
 * 本文の「見せ方」バー。本文冒頭に右寄せで置き、HTML/テキスト切替を出す。
 * （翻訳は「✨AI」パネルへ集約したのでここには無い。ズーム/アウトラインは常時
 * 表示が要るので上部ツールバー側。）HTML切替が不要なメールでは何も描画しない。
 */
export function BodyViewBar({
  textMode,
  onTextMode,
  showHtmlToggle,
}: {
  textMode: boolean;
  onTextMode: (v: boolean) => void;
  /** HTMLメールのとき true。テキストのみのメールでは何も出さない。 */
  showHtmlToggle: boolean;
}) {
  const { t } = useI18n();
  if (!showHtmlToggle) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-1.5">
      <ModeButton label="HTML" active={!textMode} onClick={() => onTextMode(false)} />
      <ModeButton
        label={t("reader.textMode")}
        active={textMode}
        onClick={() => onTextMode(true)}
      />
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
