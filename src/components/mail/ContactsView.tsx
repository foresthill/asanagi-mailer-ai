"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, Users } from "lucide-react";
import type { EmailAddress } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, relativeTime } from "./helpers";
import { ContactPage } from "./ContactPage";
import type { ContactInfo } from "@/lib/db";

/**
 * Contacts view (mini-CRM seed): address book auto-derived from cached mail.
 * Left = people ranked by recency; right = person page with the full
 * conversation timeline.
 */
export function ContactsView({
  onComposeTo,
}: {
  onComposeTo: (to: EmailAddress) => void;
}) {
  const [contacts, setContacts] = useState<ContactInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ContactInfo | null>(null);

  const [warming, setWarming] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      // Instant pass from the cache, then a warm pass that pulls the
      // sent/archived folders so rarely-opened correspondents appear too.
      try {
        const res = await fetch("/api/contacts");
        const data = await res.json();
        if (active) setContacts(data.contacts ?? []);
      } catch {
        if (active) setContacts([]);
      }
      try {
        const res = await fetch("/api/contacts?warm=1");
        const data = await res.json();
        if (active && data.contacts) setContacts(data.contacts);
      } catch {
        /* warm pass is best-effort */
      } finally {
        if (active) setWarming(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = (contacts ?? []).filter(
    (c) => !q || c.email.includes(q) || (c.name ?? "").toLowerCase().includes(q),
  );

  return (
    <>
      <div className="flex w-[384px] shrink-0 flex-col border-r border-border bg-surface">
        <header className="flex items-center gap-2 px-5 pb-3 pt-5">
          <h1 className="text-base font-semibold tracking-tight">連絡先</h1>
          <span className="ml-auto text-xs text-fg-subtle">
            {contacts ? `${filtered.length}人` : ""}
          </span>
        </header>
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 focus-within:border-accent">
            <Search className="size-3.5 text-fg-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前・アドレスで検索"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
            />
          </div>
        </div>
        <p className="flex items-center gap-1.5 px-5 pb-2 text-[11px] text-fg-subtle">
          メールのやりとりから自動生成（手入力不要）
          {warming && (
            <span className="flex items-center gap-1 text-accent">
              <Loader2 className="size-3 animate-spin" />
              送信箱・アーカイブを取得中…
            </span>
          )}
        </p>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {contacts === null ? (
            <div className="grid h-40 place-items-center text-fg-subtle">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid h-60 place-items-center px-6 text-center text-sm text-fg-subtle">
              まだ連絡先がありません。受信箱や送信箱を開くと自動で貯まります。
            </div>
          ) : (
            filtered.map((c) => {
              const label = c.name || c.email;
              const active = selected?.email === c.email;
              return (
                <button
                  key={c.email}
                  onClick={() => setSelected(c)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                    active ? "bg-accent-soft" : "hover:bg-surface-2",
                  )}
                >
                  <div
                    className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
                    style={{ background: avatarColor(label) }}
                  >
                    {label.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <span className="truncate">{label}</span>
                      {c.self && (
                        <span
                          className="shrink-0 rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent"
                          title="自分のアドレス（セルフメール＝メモのタイムラインが見られます）"
                        >
                          自分
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-fg-subtle">
                      受 {c.received}・送 {c.sent}
                      {c.name ? `・${c.email}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-fg-subtle">
                    {relativeTime(c.lastDate)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {selected ? (
        <ContactPage contact={selected} onComposeTo={onComposeTo} />
      ) : (
        <div className="grid flex-1 place-items-center bg-bg">
          <div className="flex flex-col items-center gap-3 text-fg-subtle">
            <Users className="size-10 opacity-40" />
            <p className="text-sm">連絡先を選択すると、その人との会話履歴が表示されます</p>
          </div>
        </div>
      )}
    </>
  );
}
