"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Email,
  EmailAddress,
  FolderView,
  Importance,
  MailboxState,
  SavedDraft,
} from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { EmailList } from "./EmailList";
import { EmailReader } from "./EmailReader";
import { ReplyComposer } from "./ReplyComposer";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { ScheduledPanel } from "./ScheduledPanel";
import { DraftsPanel } from "./DraftsPanel";
import { ContactsView } from "./ContactsView";
import { TriageView } from "./TriageView";
import { AiLogView } from "./AiLogView";
import { SweepDialog } from "./SweepDialog";
import type { StorageInfo } from "./StorageMeter";
import type { AccountInfo } from "@/lib/email/accounts";
import { buildCompose, type ComposeAI, type ComposeInit, type ComposeKind } from "./compose";
import { buildRows } from "./threadList";
import type { GroupAxis } from "./EmailList";

/** スレッド表示（1会話=1行）の永続化キー。既定はON。 */
const GROUPING_PREF_KEY = "asanagi:list-grouping";
/** グループ化軸（なし/アカウント別/送信者別）の永続化キー。 */
const GROUP_AXIS_KEY = "asanagi:list-group-axis";

function loadGroupingPref(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(GROUPING_PREF_KEY) !== "off";
}

function loadGroupAxis(): GroupAxis {
  if (typeof window === "undefined") return "none";
  const v = localStorage.getItem(GROUP_AXIS_KEY);
  return v === "account" || v === "sender" ? v : "none";
}

export function MailApp({ aiConfigured }: { aiConfigured: boolean }) {
  const [folder, setFolder] = useState<FolderView>("inbox");
  // "mail" = folders; "contacts" = auto-derived address book (mini-CRM).
  const [view, setView] = useState<"mail" | "contacts" | "triage" | "ailog">("mail");
  // "all" = unified inbox across accounts; otherwise a single account key.
  const [account, setAccount] = useState("all");
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [aiOk, setAiOk] = useState(aiConfigured);
  const [showSettings, setShowSettings] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [showSweep, setShowSweep] = useState(false);
  // Auto-open the morning sweep at most once per session (and 12h via storage).
  const sweepPrompted = useRef(false);
  const [emails, setEmails] = useState<Email[]>([]);
  // Cache-wide search (all accounts & folders); null = not searching.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Email[] | null>(null);
  // Gmail-style flat conversation rows (docs/04 §1.6); off = 1 mail = 1 row.
  const [grouping, setGrouping] = useState(loadGroupingPref);
  // Section grouping axis (none / by account / by sender domain).
  const [groupAxis, setGroupAxis] = useState<GroupAxis>(loadGroupAxis);
  // Bulk selection — keyed by row representative id; actions apply to every
  // mail of each checked conversation row.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Email | null>(null);
  const [thread, setThread] = useState<Email[] | null>(null);
  const threadToken = useRef(0);
  // null = not composing; otherwise the prepared compose state.
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const replying = compose !== null;
  const [classifying, setClassifying] = useState(false);
  const [counts, setCounts] = useState<Partial<Record<FolderView, number>>>({});
  const [scheduledCount, setScheduledCount] = useState(0);
  const [draftsCount, setDraftsCount] = useState(0);
  // Email ids that have a private note (自分用メモ) — for the list 📝 badge.
  const [noteIds, setNoteIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const classifyToken = useRef(0);

  const loadStorage = useCallback(async () => {
    try {
      const res = await fetch("/api/storage");
      setStorage(await res.json());
    } catch {
      /* meter is non-critical */
    }
  }, []);

  const loadDraftsCount = useCallback(async () => {
    try {
      const res = await fetch("/api/drafts");
      const data = await res.json();
      setDraftsCount((data.drafts ?? []).length);
    } catch {
      /* count badge is non-critical */
    }
  }, []);

  const loadNoteIds = useCallback(async () => {
    try {
      const res = await fetch("/api/notes");
      const data = await res.json();
      setNoteIds(new Set<string>(data.ids ?? []));
    } catch {
      /* note indicator is non-critical */
    }
  }, []);

  // Newest request wins: a slow live response must never overwrite a fresher
  // folder/account the user has since switched to.
  const listReq = useRef(0);
  const loadList = useCallback(
    async (f: FolderView, acct: string) => {
      const token = ++listReq.current;
      setLoading(true);
      const apply = (data: { emails?: Email[]; accounts?: AccountInfo[] }) => {
        if (token !== listReq.current) return; // superseded
        const list: Email[] = data.emails ?? [];
        setEmails(list);
        if (data.accounts) setAccounts(data.accounts);
        setCounts((c) => ({ ...c, [f]: list.filter((e) => !e.read || f !== "inbox").length }));
      };
      const base = `/api/emails?state=${f}&account=${encodeURIComponent(acct)}`;
      // Parse defensively: a broken/empty response (e.g. dev server mid-rebuild)
      // must never throw a runtime error or wipe the visible list.
      const readJson = async (res: Response) =>
        res.ok ? await res.json().catch(() => null) : null;
      try {
        // 1) Paint instantly from the local cache (no provider round-trip).
        try {
          const cdata = await readJson(await fetch(`${base}&cached=1`));
          if (token !== listReq.current) return;
          if (cdata && (cdata.emails ?? []).length) {
            apply(cdata);
            setLoading(false); // content is on screen; revalidate quietly
          }
        } catch {
          /* cache is best-effort; fall through to live */
        }
        // 2) Revalidate live and replace when it lands.
        const data = await readJson(await fetch(base));
        if (token !== listReq.current) return;
        if (data) {
          apply(data);
          if (data.stale?.length) {
            setToast(`オフライン表示: ${data.stale.join(", ")} はキャッシュから表示中`);
            setTimeout(() => setToast(null), 4000);
          }
        }
      } catch {
        /* network/parse failure → keep what's shown; the next load retries */
      } finally {
        if (token === listReq.current) setLoading(false);
        loadStorage(); // cache just changed → refresh the meter
      }
    },
    [loadStorage],
  );

  useEffect(() => {
    // Fetch the mailbox when the folder or account view changes (data sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadList(folder, account);
  }, [folder, account, loadList]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async count fetch
    loadDraftsCount();
  }, [loadDraftsCount]);

  useEffect(() => {
    // Refresh on mount and whenever the open mail changes (so closing a mail
    // where a note was just edited updates the list badge).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch
    loadNoteIds();
  }, [loadNoteIds, selectedId]);

  // 朝の一掃: 受信箱が読み込まれた直後に1日の最初だけポップアップ。
  // 判断済みを除いた「未さばき」が5通以上あるときだけ開く（空ポップアップや
  // 永遠の再表示を防ぐ）。
  useEffect(() => {
    if (sweepPrompted.current || showSweep) return;
    if (view !== "mail" || folder !== "inbox" || compose || searchResults !== null) return;
    if (emails.length < 5) return;
    const last = Number(localStorage.getItem("asanagi:last-sweep") ?? 0);
    if (Date.now() - last < 12 * 3600_000) return;
    sweepPrompted.current = true;
    (async () => {
      try {
        const res = await fetch("/api/sweep/reviewed");
        const reviewed = new Set<string>((await res.json()).ids ?? []);
        // 朝の一凪と同じ時間窓（直近36h）の新着だけを「未さばき」として数える。
        const recentCutoff = Date.now() - 36 * 3600_000;
        const pending = emails.filter(
          (e) => !reviewed.has(e.id) && +new Date(e.date) >= recentCutoff,
        ).length;
        if (pending >= 5) setShowSweep(true);
      } catch {
        setShowSweep(true); // 取得失敗時は従来どおり開く
      }
    })();
  }, [emails, view, folder, compose, searchResults, showSweep]);

  // On-demand full-history search (#40): cache results come instantly via
  // the debounce below; this widens to the providers' server search.
  const [serverSearched, setServerSearched] = useState(false);
  const [serverSearching, setServerSearching] = useState(false);

  // ブラウザの「戻る」で、開いている重なり（作成画面・モーダル・選択中の
  // メール）を1枚ずつ閉じる。Next.js は SPA で履歴が1件しか積まれないため、
  // 重なりが開いたら History API で1件積み、popstate で最前面を閉じる。
  // （URLは変えない＝ルーティング不要）
  const backArmed = useRef(false);
  useEffect(() => {
    const open =
      compose !== null ||
      showSettings ||
      showScheduled ||
      showDrafts ||
      showSweep ||
      selectedId !== null;
    if (open && !backArmed.current) {
      backArmed.current = true;
      history.pushState({ asanagiOverlay: true }, "");
    } else if (!open && backArmed.current) {
      // UI操作で全部閉じた → 積んだ履歴を1件消費して綺麗にする。
      backArmed.current = false;
      history.back();
    }
  }, [compose, showSettings, showScheduled, showDrafts, showSweep, selectedId]);

  useEffect(() => {
    const onPop = () => {
      backArmed.current = false;
      // 最前面のレイヤーを1枚だけ閉じる（残りは上のeffectが再度積み直す）。
      // 作成/返信はリーダーを覆い隠すので、戻るで一段＝一覧まで戻す（裏の
      // リーダーへ中途半端に戻らない）。返信の元メールの選択も解除する。
      if (compose !== null) {
        setCompose(null);
        setSelectedId(null);
        setSelected(null);
        setThread(null);
      } else if (showSweep) setShowSweep(false);
      else if (showDrafts) setShowDrafts(false);
      else if (showScheduled) setShowScheduled(false);
      else if (showSettings) setShowSettings(false);
      else if (selectedId !== null) {
        setSelectedId(null);
        setSelected(null);
        setThread(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [compose, showSweep, showDrafts, showScheduled, showSettings, selectedId]);

  // Debounced cache search; clearing the box returns to the folder view.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- query changed = new search session
    setServerSearched(false);
    if (!searchQuery.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(data.emails ?? []);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Never destroy an in-progress draft silently (実害が大きい). Any action
  // that would close the composer asks first.
  const confirmDiscard = () =>
    compose === null ||
    window.confirm("作成中のメールを破棄しますか？（まだ送信されていません）");

  const changeFolder = (f: FolderView) => {
    if (!confirmDiscard()) return;
    setView("mail");
    setFolder(f);
    // Folder clicks must visibly switch even while showing search results.
    setSearchQuery("");
    setSearchResults(null);
    setSelectedId(null);
    setSelected(null);
    setThread(null);
    setCompose(null);
    setChecked(new Set());
  };

  const changeAccount = (key: string) => {
    if (!confirmDiscard()) return;
    setAccount(key);
    setSearchQuery("");
    setSearchResults(null);
    setSelectedId(null);
    setSelected(null);
    setThread(null);
    setCompose(null);
    setChecked(new Set());
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
        if (data.flushed > 0 && folder !== "inbox") loadList(folder, account);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, [folder, account, loadList]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  // Widen the current search to the providers' full history (#40).
  const searchServer = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q || serverSearching) return;
    setServerSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&scope=server`);
      const data = await res.json();
      setSearchResults(data.emails ?? []);
      setServerSearched(true);
      if (data.stale?.length) {
        setToast(`接続できないアカウントがあります: ${data.stale.join(", ")}`);
        setTimeout(() => setToast(null), 2600);
      }
    } catch {
      setToast("サーバ検索に失敗しました");
      setTimeout(() => setToast(null), 2600);
    } finally {
      setServerSearching(false);
    }
  }, [searchQuery, serverSearching]);

  // Surface the result of the Gmail OAuth round-trip (?gmail= / ?gmail_error=).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("gmail");
    const err = params.get("gmail_error");
    if (!ok && !err) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToast(
      ok === "connected"
        ? "Gmail を接続しました"
        : `Gmail 接続に失敗しました（${err}）`,
    );
    setTimeout(() => setToast(null), 4000);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

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

  // Load the conversation for the opened email (cache/server-side threading).
  const loadThread = useCallback(async (email: Email) => {
    const token = ++threadToken.current;
    setThread(null);
    if (!email.account || !email.threadId) return;
    try {
      const res = await fetch(
        `/api/threads/${encodeURIComponent(`${email.account}/${email.threadId}`)}`,
      );
      const data = await res.json();
      if (token === threadToken.current) setThread(data.messages ?? null);
    } catch {
      /* thread view is progressive enhancement */
    }
  }, []);

  const selectEmail = useCallback(
    async (id: string) => {
      // Opening another mail would close the composer — ask before losing it.
      if (
        compose !== null &&
        !window.confirm("作成中のメールを破棄しますか？（まだ送信されていません）")
      )
        return;
      setSelectedId(id);
      setCompose(null);
      setEmails((list) => list.map((e) => (e.id === id ? { ...e, read: true } : e)));
      const res = await fetch(`/api/emails/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (data.email) {
        setSelected(data.email);
        classify(data.email);
        loadThread(data.email);
      } else {
        // 開けなかった理由を黙殺しない（Gmailトークン失効など）。
        setSelectedId(null);
        showToast(data.error ?? "メールを開けませんでした");
        if (data.needsReauth) setShowSettings(true); // 再認証へ誘導
      }
    },
    [classify, loadThread, compose],
  );

  // Thread-unit by default: a conversation row carries every member id, so
  // archiving a row clears the whole conversation (docs/04 §1.4).
  const mutateState = useCallback(
    async (ids: string[], state: MailboxState, label: string) => {
      const set = new Set(ids);
      setEmails((list) => list.filter((e) => !set.has(e.id)));
      // 消したメールを選択状態からも外す（行ホバーのアーカイブ等で選択に
      // ゴミが残り、一括操作が破綻するのを防ぐ）。
      setChecked((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next.size === prev.size ? prev : next;
      });
      if (selectedId && set.has(selectedId)) {
        setSelectedId(null);
        setSelected(null);
        setThread(null);
        setCompose(null);
      }
      // 即時フィードバック（一覧は上で除去済み）。サーバ反映は待たず背後で行い、
      // 90通でもUIが固まらない。失敗時だけ通知して実状態に取り直す。
      showToast(ids.length > 1 ? `${label}（${ids.length}通）` : label);
      void (async () => {
        const results = await Promise.all(
          ids.map((id) =>
            fetch(`/api/emails/${encodeURIComponent(id)}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ state }),
            }).catch(() => null),
          ),
        );
        const failed = results.filter((r) => !r || !r.ok);
        if (!failed.length) return;
        const reauth = results.some((r) => r?.status === 401);
        showToast(
          reauth
            ? "Gmailの認証が切れています（接続設定から再認証してください）"
            : `${failed.length}通を移動できませんでした（サーバ反映に失敗）`,
        );
        if (reauth) setShowSettings(true);
        loadList(folder, account); // 楽観的除去を取り消し、実状態に同期
      })();
    },
    [selectedId, folder, account, loadList],
  );

  const archive = (ids: string[]) => mutateState(ids, "archived", "アーカイブしました");

  /** 朝の一掃の実行: 推奨ごとにまとめて移動し、スヌーズ時刻を記録。 */
  const applySweep = async (archiveIds: string[], trashIds: string[]) => {
    if (archiveIds.length) await mutateState(archiveIds, "archived", "一凪: アーカイブ");
    if (trashIds.length) await mutateState(trashIds, "trashed", "一凪: ゴミ箱へ");
    localStorage.setItem("asanagi:last-sweep", String(Date.now()));
  };
  const trash = (ids: string[]) => mutateState(ids, "trashed", "ゴミ箱に移動しました");
  const restore = (ids: string[]) => mutateState(ids, "inbox", "受信箱に戻しました");

  const toggleGrouping = () =>
    setGrouping((v) => {
      const next = !v;
      try {
        localStorage.setItem(GROUPING_PREF_KEY, next ? "on" : "off");
      } catch {
        /* private mode etc. — preference just won't stick */
      }
      return next;
    });

  const changeGroupAxis = (axis: GroupAxis) => {
    setGroupAxis(axis);
    try {
      localStorage.setItem(GROUP_AXIS_KEY, axis);
    } catch {
      /* private mode etc. — preference just won't stick */
    }
  };

  // Search results stay ungrouped: they span folders and the user is
  // locating a specific mail, not triaging conversations.
  const rows = buildRows(searchResults ?? emails, grouping && searchResults === null);

  // Bulk selection: rows are checked by representative id; an action expands
  // each checked row to its full conversation (ThreadRow.ids).
  const toggleChecked = useCallback((repId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(repId)) next.delete(repId);
      else next.add(repId);
      return next;
    });
  }, []);

  const bulkAct = async (state: MailboxState, label: string) => {
    const ids = rows.filter((r) => checked.has(r.email.id)).flatMap((r) => r.ids);
    if (!ids.length) return;
    setChecked(new Set());
    await mutateState(ids, state, label);
  };

  /** Star toggle — optimistic UI, server-synced (Gmail STARRED / IMAP \Flagged). */
  const toggleStar = useCallback(
    async (id: string) => {
      const target = emails.find((e) => e.id === id) ?? (selected?.id === id ? selected : null);
      const next = !target?.starred;
      setEmails((list) =>
        // In the starred view, unstarring removes the row right away.
        folder === "starred" && !next
          ? list.filter((e) => e.id !== id)
          : list.map((e) => (e.id === id ? { ...e, starred: next } : e)),
      );
      setSelected((s) => (s && s.id === id ? { ...s, starred: next } : s));
      try {
        const res = await fetch(`/api/emails/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ starred: next }),
        });
        if (!res.ok) throw new Error();
        showToast(next ? "スターを付けました" : "スターを外しました");
      } catch {
        // Roll back the optimistic update on failure.
        setEmails((list) => list.map((e) => (e.id === id ? { ...e, starred: !next } : e)));
        setSelected((s) => (s && s.id === id ? { ...s, starred: !next } : s));
        showToast("スターの更新に失敗しました");
      }
    },
    [emails, selected, folder],
  );

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

  /** Open the composer with a prepared initial state. */
  const openCompose = useCallback(
    (kind: ComposeKind, mode: ComposeAI) => {
      if (kind !== "new" && !selected) return;
      // Starting a new compose while one is open would replace the draft.
      if (
        compose !== null &&
        !window.confirm("作成中のメールを破棄しますか？（まだ送信されていません）")
      )
        return;
      const selfAddresses = accounts.map((a) => a.address).filter((s): s is string => !!s);
      const init = buildCompose(kind, mode, selected ?? undefined, selfAddresses);
      // New mail from a specific account view sends from that account.
      if (kind === "new" && account !== "all") init.account = account;
      // Conversation so far → AI drafting context (agreed dates, open points).
      if (kind !== "new" && thread && thread.length > 1) init.history = thread;
      setCompose(init);
    },
    [selected, accounts, account, thread, compose],
  );

  const onSent = (kind: "sent" | "scheduled") => {
    const wasReply = compose?.kind === "reply" || compose?.kind === "replyAll";
    const fromDraft = compose?.draftId != null;
    setCompose(null);
    if (wasReply && selected && folder === "inbox") {
      // Send & archive — keep the inbox clean (replies only; not forward/new).
      mutateState([selected.id], "archived", kind === "sent" ? "送信してアーカイブしました" : "予約してアーカイブしました");
    } else {
      showToast(kind === "sent" ? "送信しました" : "予約しました");
    }
    if (fromDraft) loadDraftsCount(); // sent draft was deleted server-side
  };

  // Draft saved from the composer → close it, confirm, refresh the badge.
  const onSavedDraft = () => {
    setCompose(null);
    showToast("下書きを保存しました");
    loadDraftsCount();
  };

  // Resume editing a saved draft in the composer.
  const openDraft = (d: SavedDraft) => {
    setShowDrafts(false);
    setCompose({
      kind: "new",
      mode: "plain",
      to: d.to ?? [],
      cc: d.cc ?? [],
      subject: d.subject,
      body: d.body,
      account: d.account,
      inReplyTo: d.inReplyTo,
      threadId: d.threadId,
      draftId: d.id,
    });
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never hijack OS/browser shortcuts (Cmd+C copy, Cmd+R reload, …).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || replying) return;
      // Don't steal "c" etc. while the user has text selected for copying.
      if (!window.getSelection()?.isCollapsed) return;
      if (e.key === "c") {
        // Compose new — works even with an empty list.
        e.preventDefault();
        openCompose("new", "plain");
        return;
      }
      if (view !== "mail" || !rows.length) return;
      // Navigation and bulk actions operate on conversation rows.
      const idx = rows.findIndex((r) => r.email.id === selectedId);
      const rowIds = idx >= 0 ? rows[idx].ids : selectedId ? [selectedId] : [];
      if (e.key === "j") {
        e.preventDefault();
        selectEmail(rows[Math.min(rows.length - 1, idx + 1)]?.email.id ?? rows[0].email.id);
      } else if (e.key === "k") {
        e.preventDefault();
        selectEmail(rows[Math.max(0, idx - 1)]?.email.id ?? rows[0].email.id);
      } else if (e.key === "s" && selectedId) {
        e.preventDefault();
        toggleStar(selectedId);
      } else if (e.key === "x" && selectedId) {
        // Gmail-style: toggle the focused row in/out of the bulk selection.
        e.preventDefault();
        const row = rows.find((r) => r.email.id === selectedId);
        if (row) toggleChecked(row.email.id);
      } else if (e.key === "e" && rowIds.length && folder !== "archived" && folder !== "sent") {
        archive(rowIds);
      } else if ((e.key === "#" || e.key === "Backspace") && rowIds.length && folder !== "trashed") {
        trash(rowIds);
      } else if (e.key === "r" && selected) {
        e.preventDefault();
        openCompose("reply", "ai");
      } else if (e.key === "R" && selected) {
        e.preventDefault();
        openCompose("reply", "plain");
      } else if (e.key === "a" && selected) {
        e.preventDefault();
        openCompose("replyAll", "plain");
      } else if (e.key === "f" && selected) {
        e.preventDefault();
        openCompose("forward", "plain");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedId, selected, folder, replying, view, openCompose]);

  return (
    <div className="flex h-full">
      <Sidebar
        folder={folder}
        view={view}
        counts={counts}
        scheduledCount={scheduledCount}
        draftsCount={draftsCount}
        aiConfigured={aiOk}
        accounts={accounts}
        account={account}
        storage={storage}
        onSelect={changeFolder}
        onSelectView={(v) => {
          if (!confirmDiscard()) return;
          setView(v);
          setCompose(null);
        }}
        onSelectAccount={changeAccount}
        onOpenSettings={() => setShowSettings(true)}
        onOpenScheduled={() => setShowScheduled(true)}
        onOpenDrafts={() => setShowDrafts(true)}
        onOpenSweep={() => setShowSweep(true)}
        onCompose={() => openCompose("new", "plain")}
      />
      {view === "contacts" && !compose && (
        <ContactsView
          onComposeTo={(to: EmailAddress) =>
            setCompose({
              kind: "new",
              mode: "plain",
              to: [to],
              cc: [],
              subject: "",
              body: "",
              account: account !== "all" ? account : undefined,
            })
          }
        />
      )}
      {view === "triage" && !compose && <TriageView />}
      {view === "ailog" && !compose && <AiLogView />}
      {view === "mail" && !replying && (
        <EmailList
          folder={folder}
          rows={rows}
          loading={loading && searchResults === null}
          selectedId={selectedId}
          searchQuery={searchQuery}
          searching={searchResults !== null}
          grouping={grouping}
          groupAxis={groupAxis}
          noteIds={noteIds}
          onChangeGroupAxis={changeGroupAxis}
          accountLabels={
            // Show the origin badge when rows can mix accounts:
            // unified inbox, or search results (always cross-account).
            accounts.length > 1 && (account === "all" || searchResults !== null)
              ? Object.fromEntries(accounts.map((a) => [a.key, a.address ?? a.label]))
              : null
          }
          serverSearched={serverSearched}
          serverSearching={serverSearching}
          checkedIds={checked}
          onToggleCheck={toggleChecked}
          onCheckAll={() => setChecked(new Set(rows.map((r) => r.email.id)))}
          onClearChecked={() => setChecked(new Set())}
          onBulkArchive={() => bulkAct("archived", "一括アーカイブしました")}
          onBulkTrash={() => bulkAct("trashed", "一括でゴミ箱に移動しました")}
          onServerSearch={searchServer}
          onSearchChange={setSearchQuery}
          onToggleGrouping={toggleGrouping}
          onSelect={selectEmail}
          onArchive={archive}
          onTrash={trash}
          onToggleStar={toggleStar}
          onRefresh={() => loadList(folder, account)}
        />
      )}
      {compose ? (
        <ReplyComposer
          // Restart the composer whenever the kind/mode/source changes.
          key={`${compose.kind}-${compose.mode}-${compose.source?.id ?? "new"}-${compose.to[0]?.email ?? ""}`}
          init={compose}
          accounts={accounts}
          aiConfigured={aiOk}
          onSent={onSent}
          onClose={() => setCompose(null)}
          onNeedsReauth={() => setShowSettings(true)}
          onSavedDraft={onSavedDraft}
        />
      ) : view === "mail" ? (
        <EmailReader
          email={selected}
          thread={thread}
          folder={folder}
          classifying={classifying}
          onArchive={() => selected && archive([selected.id])}
          onTrash={() => selected && trash([selected.id])}
          onRestore={() => selected && restore([selected.id])}
          onReply={openCompose}
          onToggleStar={() => selected && toggleStar(selected.id)}
          onImportanceFeedback={onImportanceFeedback}
          onNoteSaved={loadNoteIds}
        />
      ) : null}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-slide-up rounded-full bg-fg px-4 py-2 text-sm text-bg shadow-[var(--shadow)]">
          {toast}
        </div>
      )}

      {showSweep && (
        <SweepDialog
          emails={emails}
          onApply={applySweep}
          onClose={() => {
            // スキップでも12時間はスヌーズ（毎回せがまない）。
            localStorage.setItem("asanagi:last-sweep", String(Date.now()));
            setShowSweep(false);
          }}
        />
      )}

      <ConnectionsSettings
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={setAiOk}
      />
      <ScheduledPanel open={showScheduled} onClose={() => setShowScheduled(false)} />
      <DraftsPanel
        open={showDrafts}
        onClose={() => setShowDrafts(false)}
        onOpenDraft={openDraft}
        onChanged={loadDraftsCount}
      />
    </div>
  );
}
