"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Email, Importance, MailboxState } from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { EmailList } from "./EmailList";
import { EmailReader } from "./EmailReader";
import { ReplyComposer } from "./ReplyComposer";

export function MailApp({ aiConfigured }: { aiConfigured: boolean }) {
  const [folder, setFolder] = useState<MailboxState>("inbox");
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Email | null>(null);
  const [replying, setReplying] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [counts, setCounts] = useState<Partial<Record<MailboxState, number>>>({});
  const [scheduledCount, setScheduledCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const classifyToken = useRef(0);

  const loadList = useCallback(async (f: MailboxState) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/emails?state=${f}`);
      const data = await res.json();
      const list: Email[] = data.emails ?? [];
      setEmails(list);
      setCounts((c) => ({ ...c, [f]: list.filter((e) => !e.read || f !== "inbox").length }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch the mailbox from the server when the folder changes (data sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadList(folder);
  }, [folder, loadList]);

  const changeFolder = (f: MailboxState) => {
    setFolder(f);
    setSelectedId(null);
    setSelected(null);
    setReplying(false);
  };

  // Poll the scheduler (also flushes any due sends server-side).
  useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch("/api/schedule");
        const data = await res.json();
        setScheduledCount(
          (data.items ?? []).filter((s: { status: string }) => s.status === "scheduled").length,
        );
        if (data.flushed > 0 && folder !== "inbox") loadList(folder);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, [folder, loadList]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const classify = useCallback(async (email: Email) => {
    if (email.importance) return;
    const token = ++classifyToken.current;
    setClassifying(true);
    try {
      const res = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (token !== classifyToken.current) return; // a newer selection won
      const patch = { importance: data.importance as Importance, importanceReason: data.reason };
      setSelected((s) => (s && s.id === email.id ? { ...s, ...patch } : s));
      setEmails((list) => list.map((e) => (e.id === email.id ? { ...e, ...patch } : e)));
    } finally {
      if (token === classifyToken.current) setClassifying(false);
    }
  }, []);

  const selectEmail = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setReplying(false);
      setEmails((list) => list.map((e) => (e.id === id ? { ...e, read: true } : e)));
      const res = await fetch(`/api/emails/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.email) {
        setSelected(data.email);
        classify(data.email);
      }
    },
    [classify],
  );

  const mutateState = useCallback(
    async (id: string, state: MailboxState, label: string) => {
      setEmails((list) => list.filter((e) => e.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setSelected(null);
        setReplying(false);
      }
      await fetch(`/api/emails/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
      showToast(label);
    },
    [selectedId],
  );

  const archive = (id: string) => mutateState(id, "archived", "アーカイブしました");
  const trash = (id: string) => mutateState(id, "trashed", "ゴミ箱に移動しました");
  const restore = (id: string) => mutateState(id, "inbox", "受信箱に戻しました");

  const onImportanceFeedback = async (importance: Importance) => {
    if (!selected) return;
    setSelected({ ...selected, importance, importanceReason: "あなたが指定した重要度です。" });
    setEmails((list) =>
      list.map((e) => (e.id === selected.id ? { ...e, importance } : e)),
    );
    await fetch(`/api/emails/${encodeURIComponent(selected.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        importanceFeedback: { importance, fromEmail: selected.from.email },
      }),
    });
    showToast("学習しました（今後の判定に反映されます）");
  };

  const onSent = (kind: "sent" | "scheduled") => {
    setReplying(false);
    if (selected && folder === "inbox") {
      // Send & archive — keep the inbox clean.
      mutateState(selected.id, "archived", kind === "sent" ? "送信してアーカイブしました" : "予約してアーカイブしました");
    } else {
      showToast(kind === "sent" ? "送信しました" : "予約しました");
    }
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || replying) return;
      if (!emails.length) return;
      const idx = emails.findIndex((m) => m.id === selectedId);
      if (e.key === "j") {
        e.preventDefault();
        selectEmail(emails[Math.min(emails.length - 1, idx + 1)]?.id ?? emails[0].id);
      } else if (e.key === "k") {
        e.preventDefault();
        selectEmail(emails[Math.max(0, idx - 1)]?.id ?? emails[0].id);
      } else if (e.key === "e" && selectedId && folder !== "archived") {
        archive(selectedId);
      } else if ((e.key === "#" || e.key === "Backspace") && selectedId && folder !== "trashed") {
        trash(selectedId);
      } else if (e.key === "r" && selected) {
        e.preventDefault();
        setReplying(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emails, selectedId, selected, folder, replying]);

  return (
    <div className="flex h-full">
      <Sidebar
        folder={folder}
        counts={counts}
        scheduledCount={scheduledCount}
        aiConfigured={aiConfigured}
        onSelect={changeFolder}
      />
      {!replying && (
        <EmailList
          folder={folder}
          emails={emails}
          loading={loading}
          selectedId={selectedId}
          onSelect={selectEmail}
          onArchive={archive}
          onTrash={trash}
        />
      )}
      {replying && selected ? (
        <ReplyComposer
          email={selected}
          aiConfigured={aiConfigured}
          onSent={onSent}
          onClose={() => setReplying(false)}
        />
      ) : (
        <EmailReader
          email={selected}
          folder={folder}
          classifying={classifying}
          onArchive={() => selected && archive(selected.id)}
          onTrash={() => selected && trash(selected.id)}
          onRestore={() => selected && restore(selected.id)}
          onReply={() => setReplying(true)}
          onImportanceFeedback={onImportanceFeedback}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-slide-up rounded-full bg-fg px-4 py-2 text-sm text-bg shadow-[var(--shadow)]">
          {toast}
        </div>
      )}
    </div>
  );
}
