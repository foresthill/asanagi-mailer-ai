"use client";

import { useState } from "react";
import { CalendarPlus, Check, ExternalLink, Loader2, CalendarX2, Repeat } from "lucide-react";
import type { MeetingInvite } from "@/lib/types";

/** "6月22日(月) 17:00–18:00" style range for the card. */
function formatRange(invite: MeetingInvite): string | null {
  if (!invite.start) return null;
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  if (invite.allDay) {
    const d = new Date(`${invite.start.slice(0, 10)}T00:00:00`);
    return `${d.getMonth() + 1}月${d.getDate()}日(${days[d.getDay()]}) 終日`;
  }
  const s = new Date(invite.start);
  const hm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  let out = `${s.getMonth() + 1}月${s.getDate()}日(${days[s.getDay()]}) ${hm(s)}`;
  if (invite.end) {
    const e = new Date(invite.end);
    out +=
      s.toDateString() === e.toDateString()
        ? `–${hm(e)}`
        : ` – ${e.getMonth() + 1}月${e.getDate()}日 ${hm(e)}`;
  }
  return out;
}

/**
 * 会議カード（docs/05 §1）: 招待メールの上部に出る要約と
 * 「Googleカレンダーに登録」「会議に参加」。登録は events.import (iCalUID)
 * なので二度押しても重複しない。
 */
export function MeetingCard({ emailId, invite }: { emailId: string; invite: MeetingInvite }) {
  const [state, setState] = useState<"idle" | "adding" | "added" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const cancelled = invite.method?.toUpperCase() === "CANCEL";
  const range = formatRange(invite);
  const canRegister = Boolean(invite.start) && !cancelled;

  async function register() {
    setState("adding");
    setMessage(null);
    try {
      const res = await fetch("/api/calendar/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: emailId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMessage(data.error ?? "登録に失敗しました");
        return;
      }
      setState("added");
      setLink(data.htmlLink ?? null);
    } catch {
      setState("error");
      setMessage("登録に失敗しました（ネットワーク）");
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-accent/30 bg-accent-soft/40 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg">
          {cancelled ? <CalendarX2 className="size-4" /> : <CalendarPlus className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="truncate">{invite.summary ?? "会議の招待"}</span>
            {invite.recurring && (
              <span
                title="定期会議（登録されるのは初回分です）"
                className="flex shrink-0 items-center gap-0.5 rounded bg-surface px-1 text-[10px] font-normal text-fg-muted"
              >
                <Repeat className="size-2.5" />
                定期
              </span>
            )}
          </p>
          {cancelled ? (
            <p className="mt-0.5 text-xs font-medium text-high">この会議は中止されました</p>
          ) : (
            <>
              {range && <p className="mt-0.5 text-xs text-fg">{range}</p>}
              {invite.location && !invite.location.startsWith("http") && (
                <p className="truncate text-xs text-fg-muted">場所: {invite.location}</p>
              )}
              {invite.organizer && (
                <p className="truncate text-xs text-fg-subtle">
                  主催: {invite.organizer.name ?? invite.organizer.email}
                </p>
              )}
            </>
          )}
          {message && <p className="mt-1 text-xs text-high">{message}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {canRegister &&
            (state === "added" ? (
              <a
                href={link ?? "https://calendar.google.com/"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-medium text-emerald-600"
              >
                <Check className="size-3.5" />
                登録済み — 開く
              </a>
            ) : (
              <button
                onClick={register}
                disabled={state === "adding"}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow-sm hover:opacity-90 disabled:opacity-60"
              >
                {state === "adding" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CalendarPlus className="size-3.5" />
                )}
                Googleカレンダーに登録
              </button>
            ))}
          {invite.joinUrl && !cancelled && (
            <a
              href={invite.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent"
            >
              <ExternalLink className="size-3.5" />
              会議に参加
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
