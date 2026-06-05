"use client";

import { useState } from "react";
import { Clock, X } from "lucide-react";

function presets(): { label: string; date: Date }[] {
  const now = new Date();
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);

  const tomorrow9 = new Date(now);
  tomorrow9.setDate(now.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);

  const monday9 = new Date(now);
  const daysUntilMon = (8 - monday9.getDay()) % 7 || 7;
  monday9.setDate(now.getDate() + daysUntilMon);
  monday9.setHours(9, 0, 0, 0);

  return [
    { label: "1時間後", date: inHour },
    { label: "明日の朝 9:00", date: tomorrow9 },
    { label: "月曜の朝 9:00", date: monday9 },
  ];
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleDialog({
  onSchedule,
  onClose,
}: {
  onSchedule: (iso: string) => void;
  onClose: () => void;
}) {
  // Lazy initializers run once and may read the clock (React allows impurity here).
  const [options] = useState(() => presets());
  const [custom, setCustom] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[380px] animate-slide-up rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <Clock className="size-4 text-accent" />
          <h3 className="text-sm font-semibold">送信日時を選択</h3>
          <button
            onClick={onClose}
            className="ml-auto grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {options.map((p) => (
            <button
              key={p.label}
              onClick={() => onSchedule(p.date.toISOString())}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-accent hover:bg-accent-soft"
            >
              <span>{p.label}</span>
              <span className="text-xs text-fg-subtle">
                {p.date.toLocaleString("ja-JP", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <label className="text-xs text-fg-muted">カスタム日時</label>
          <div className="mt-1.5 flex gap-2">
            <input
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={() => onSchedule(new Date(custom).toISOString())}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
            >
              予約
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
