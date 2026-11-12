"use client";

import { useState } from "react";
import { FolderOpen } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import {
  getDownloadAsk,
  setDownloadAsk,
  getDownloadDir,
  setDownloadDir,
} from "@/lib/download-prefs";

/** True inside the Tauri desktop app. */
function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 添付ファイルの保存設定（デスクトップ専用）。毎回ダイアログを出すか、既定フォルダへ
 * 即保存するかを選ぶ。端末ごとの好みなので localStorage（@/lib/download-prefs）。
 * ブラウザ版はブラウザのダウンロード先に従うため、このセクションは出さない。
 */
export function DownloadSection() {
  const { t } = useI18n();
  const [ask, setAsk] = useState<boolean>(getDownloadAsk);
  const [dir, setDir] = useState<string>(getDownloadDir);

  if (!isDesktopApp()) return null;

  async function pick() {
    const { invoke } = await import("@tauri-apps/api/core");
    const picked = await invoke<string | null>("pick_folder");
    if (picked) {
      setDownloadDir(picked);
      setDir(picked);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg px-3 py-2.5">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={ask}
          onChange={(e) => {
            setDownloadAsk(e.target.checked);
            setAsk(e.target.checked);
          }}
          className="mt-0.5 size-4 accent-[var(--accent,#6d5ae6)]"
        />
        <span className="flex flex-col gap-0.5 text-xs">
          <span className="font-medium">{t("download.ask")}</span>
          <span className="text-[11px] leading-relaxed text-fg-subtle">
            {t("download.askDesc")}
          </span>
        </span>
      </label>

      {!ask && (
        <div className="flex flex-col gap-1.5 pl-6">
          <span className="text-[11px] font-medium text-fg-muted">
            {t("download.dir")}
          </span>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-fg-subtle">
              {dir || t("download.dirDefault")}
            </span>
            <button
              type="button"
              onClick={pick}
              className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-accent"
            >
              <FolderOpen className="size-3.5" />
              {t("download.pick")}
            </button>
            {dir && (
              <button
                type="button"
                onClick={() => {
                  setDownloadDir("");
                  setDir("");
                }}
                className="shrink-0 rounded-md px-2 py-1 text-[11px] text-fg-subtle transition-colors hover:text-fg"
              >
                {t("download.reset")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
