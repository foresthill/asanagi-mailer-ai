"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Email,
  EmailAddress,
  FolderView,
  Importance,
  MailboxState,
  SavedDraft,
  ContactLabel,
  ContactMeta,
} from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { EmailList } from "./EmailList";
import { EmailReader } from "./EmailReader";
import { ResizeHandle } from "./ResizeHandle";
import { ReplyComposer } from "./ReplyComposer";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { ScheduledPanel } from "./ScheduledPanel";
import { DraftsPanel } from "./DraftsPanel";
import { ContactsView } from "./ContactsView";
import { TriageView } from "./TriageView";
import { AiLogView } from "./AiLogView";
import { ProjectsView } from "./ProjectsView";
import { SweepDialog } from "./SweepDialog";
import type { StorageInfo } from "./StorageMeter";
import type { AccountInfo } from "@/lib/email/accounts";
import {
  buildCompose,
  greetTargetOf,
  type ComposeAI,
  type ComposeInit,
  type ComposeKind,
  type RecipientMeta,
} from "./compose";
import { buildRows } from "./threadList";
import { useI18n } from "@/lib/i18n";
import type { GroupAxis } from "./EmailList";
import type { SearchDigest } from "@/app/api/ai/search-digest/route";

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

/** 一覧ペイン幅（ドラッグで可変・px）の永続化キーと既定値。 */
const LIST_WIDTH_KEY = "asanagi:list-width";
const DEFAULT_LIST_WIDTH = 384;
function loadListWidth(): number {
  if (typeof window === "undefined") return DEFAULT_LIST_WIDTH;
  const n = Number(localStorage.getItem(LIST_WIDTH_KEY));
  return Number.isFinite(n) && n >= 300 && n <= 680 ? n : DEFAULT_LIST_WIDTH;
}

/** geekレイアウトで一覧(上)の高さ（ドラッグで可変・px）。 */
const LIST_HEIGHT_KEY = "asanagi:list-height";
const DEFAULT_LIST_HEIGHT = 260;
function loadListHeight(): number {
  if (typeof window === "undefined") return DEFAULT_LIST_HEIGHT;
  const n = Number(localStorage.getItem(LIST_HEIGHT_KEY));
  return Number.isFinite(n) && n >= 140 && n <= 700 ? n : DEFAULT_LIST_HEIGHT;
}

/** 画面レイアウト: classic=一覧(左)｜本文(右) / geek=一覧(上)｜本文(下)。 */
const LAYOUT_KEY = "asanagi:layout";
type Layout = "classic" | "geek";
function loadLayout(): Layout {
  if (typeof window === "undefined") return "classic";
  return localStorage.getItem(LAYOUT_KEY) === "geek" ? "geek" : "classic";
}

export function MailApp({ aiConfigured }: { aiConfigured: boolean }) {
  // Current UI language — sent to AI routes so user-facing output (importance
  // reasons, digests, project summaries) is written in the user's language.
  const { locale } = useI18n();
  const [folder, setFolder] = useState<FolderView>("inbox");
  // "mail" = folders; "contacts" = auto-derived address book (mini-CRM).
  const [view, setView] = useState<
    "mail" | "contacts" | "triage" | "ailog" | "projects"
  >("mail");
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
  // Latest list, read (not depended on) by mutateState so it can map the
  // archived/trashed ids back to their senders for learning.
  const emailsRef = useRef<Email[]>([]);
  useEffect(() => {
    emailsRef.current = emails;
  }, [emails]);
  // Cache-wide search (all accounts & folders); null = not searching.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Email[] | null>(null);
  /** True when the last search request failed (vs genuinely 0 hits) — so the UI
   *  shows an error instead of a misleading「該当なし」when the server errors. */
  const [searchError, setSearchError] = useState(false);
  // 検索モード: keyword=そのまま一覧 / ai=ヒット群から経緯をAIがまとめる。
  const [searchMode, setSearchMode] = useState<"keyword" | "ai">("keyword");
  // AI検索の経緯（要約＋時系列＋要点＋根拠メール）。"loading"/"error"/結果/null。
  const [searchDigest, setSearchDigest] = useState<
    "loading" | "error" | SearchDigest | null
  >(null);
  // Gmail-style flat conversation rows (docs/04 §1.6); off = 1 mail = 1 row.
  const [grouping, setGrouping] = useState(loadGroupingPref);
  // Section grouping axis (none / by account / by sender domain).
  const [groupAxis, setGroupAxis] = useState<GroupAxis>(loadGroupAxis);
  // Bulk selection — keyed by row representative id; actions apply to every
  // mail of each checked conversation row.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // UI layout prefs. Initialised to SSR-safe defaults; the persisted values are
  // applied after mount (below) — reading localStorage during init would make
  // the server HTML and first client render disagree (hydration mismatch).
  // classic = 一覧(左)｜本文(右)・幅可変 / geek = 一覧(上)｜本文(下)・高さ可変。
  const [layout, setLayout] = useState<Layout>("classic");
  const [listWidth, setListWidth] = useState<number>(DEFAULT_LIST_WIDTH); // classic: 一覧の幅
  const [listHeight, setListHeight] = useState<number>(DEFAULT_LIST_HEIGHT); // geek: 一覧の高さ
  useEffect(() => {
    // Apply persisted prefs on the client only (post-hydration).
    /* eslint-disable react-hooks/set-state-in-effect */
    setLayout(loadLayout());
    setListWidth(loadListWidth());
    setListHeight(loadListHeight());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  const resizeList = useCallback((deltaX: number) => {
    setListWidth((w) => {
      const next = Math.min(680, Math.max(300, w + deltaX));
      try {
        localStorage.setItem(LIST_WIDTH_KEY, String(next));
      } catch {
        /* private mode — width just won't persist */
      }
      return next;
    });
  }, []);
  const resizeListHeight = useCallback((deltaY: number) => {
    setListHeight((h) => {
      const next = Math.min(700, Math.max(140, h + deltaY));
      try {
        localStorage.setItem(LIST_HEIGHT_KEY, String(next));
      } catch {
        /* private mode — height just won't persist */
      }
      return next;
    });
  }, []);
  const setLayoutMode = useCallback((next: Layout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* private mode — preference just won't stick */
    }
  }, []);
  const [loading, setLoading] = useState(true);
  /** Live revalidation in flight — drives the "更新中…" indicator even after the
   *  cache has painted (stale-while-revalidate), so 更新 gives visible feedback. */
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Email | null>(null);
  const [thread, setThread] = useState<Email[] | null>(null);
  const threadToken = useRef(0);
  // null = not composing; otherwise the prepared compose state.
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  // Minimized-to-dock: keeps the composer mounted (draft preserved) while the
  // reader shows behind, so you can read a mail while composing.
  const [composeMinimized, setComposeMinimized] = useState(false);
  const replying = compose !== null;
  // Open a composer full (never inherit a stale minimized dock). All open paths
  // go through this so the reset lives in one place.
  const startCompose = (init: ComposeInit) => {
    setComposeMinimized(false);
    setCompose(init);
  };
  const [classifying, setClassifying] = useState(false);
  const [counts, setCounts] = useState<Partial<Record<FolderView, number>>>({});
  const [scheduledCount, setScheduledCount] = useState(0);
  const [draftsCount, setDraftsCount] = useState(0);
  // Unsent drafts left untouched for 3+ days — inbox aged-draft reminder.
  const [agedDraftCount, setAgedDraftCount] = useState(0);
  // 実際の下書き一覧（メールから「続きを書く」で呼び出す・一覧に📝を出すため）。
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  // Email ids that have a private note (自分用メモ) — for the list 📝 badge.
  const [noteIds, setNoteIds] = useState<Set<string>>(new Set());
  // Contact labels (重要取引先/迷惑) — resolved from the contacts store for badges.
  const [contactMeta, setContactMeta] = useState<ContactMeta[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const classifyToken = useRef(0);
  const selectToken = useRef(0);

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
      const list = (data.drafts ?? []) as SavedDraft[];
      setDraftsCount(list.length);
      setDrafts(list);
      const agedBefore = Date.now() - 3 * 24 * 60 * 60 * 1000;
      setAgedDraftCount(
        list.filter((d) => new Date(d.updatedAt).getTime() < agedBefore).length,
      );
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

  const loadContactMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/contacts/meta");
      const data = await res.json();
      setContactMeta((data.entries ?? []) as ContactMeta[]);
    } catch {
      /* label badges are non-critical */
    }
  }, []);

  // Resolve a contact's label: person override → company(domain) default.
  const contactLabel = useCallback(
    (email?: string): ContactLabel | undefined => {
      if (!email) return undefined;
      const e = email.toLowerCase();
      const at = e.lastIndexOf("@");
      const dom = at >= 0 ? e.slice(at + 1) : "";
      const person = contactMeta.find(
        (m) => m.scope === "person" && m.key.toLowerCase() === e,
      );
      if (person?.label) return person.label;
      const domain = contactMeta.find(
        (m) => m.scope === "domain" && m.key.toLowerCase() === dom,
      );
      return domain?.label;
    },
    [contactMeta],
  );

  // Newest request wins: a slow live response must never overwrite a fresher
  // folder/account the user has since switched to.
  const listReq = useRef(0);
  const loadList = useCallback(
    async (f: FolderView, acct: string) => {
      const token = ++listReq.current;
      setLoading(true);
      setRefreshing(true);
      const apply = (data: { emails?: Email[]; accounts?: AccountInfo[] }) => {
        if (token !== listReq.current) return; // superseded
        const list: Email[] = data.emails ?? [];
        setEmails(list);
        if (data.accounts) setAccounts(data.accounts);
        setCounts((c) => ({
          ...c,
          [f]: list.filter((e) => !e.read || f !== "inbox").length,
        }));
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
            setToast(
              `オフライン表示: ${data.stale.join(", ")} はキャッシュから表示中`,
            );
            setTimeout(() => setToast(null), 4000);
          }
        }
      } catch {
        /* network/parse failure → keep what's shown; the next load retries */
      } finally {
        if (token === listReq.current) {
          setLoading(false);
          setRefreshing(false); // live revalidation done
        }
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

  useEffect(() => {
    // Load contact labels on mount and whenever we return to the mail view (so
    // labels edited in Contacts show up on the list). eslint-disable justified:
    // this only kicks off an async fetch that sets state in its callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch
    if (view === "mail") loadContactMeta();
  }, [loadContactMeta, view]);

  // 朝の一掃: 受信箱が読み込まれた直後に1日の最初だけポップアップ。
  // 判断済みを除いた「未さばき」が5通以上あるときだけ開く（空ポップアップや
  // 永遠の再表示を防ぐ）。
  useEffect(() => {
    if (sweepPrompted.current || showSweep) return;
    if (
      view !== "mail" ||
      folder !== "inbox" ||
      compose ||
      searchResults !== null
    )
      return;
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
  // Folder navigation history (戻る returns to the previously-viewed folder).
  const folderStack = useRef<FolderView[]>([]);
  // True while we consume our own pushed entry via history.back() — keeps the
  // popstate handler from also reverting a folder for our self-fired event.
  const suppressPop = useRef(false);
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
      suppressPop.current = true;
      history.back();
    }
  }, [compose, showSettings, showScheduled, showDrafts, showSweep, selectedId]);

  useEffect(() => {
    const onPop = () => {
      // Ignore the popstate we triggered ourselves to clean up an overlay entry.
      if (suppressPop.current) {
        suppressPop.current = false;
        return;
      }
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
      } else if (folderStack.current.length > 0) {
        // No overlay open → 戻るで前のフォルダへ。
        const prev = folderStack.current.pop()!;
        setView("mail");
        setFolder(prev);
        setSearchQuery("");
        setSearchResults(null);
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
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(searchQuery)}`,
        );
        if (!res.ok) throw new Error(`search ${res.status}`);
        const data = await res.json();
        setSearchError(false);
        setSearchResults(data.emails ?? []);
      } catch {
        // Distinguish failure from "no hits": an error must not read as 0件.
        setSearchError(true);
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Never destroy an in-progress draft silently (実害が大きい). Any action
  // that would close the composer asks first.
  // A minimized composer stays docked across navigation, so browsing away never
  // loses the draft — no discard prompt, and don't close the composer.
  const confirmDiscard = () =>
    compose === null ||
    composeMinimized ||
    window.confirm("作成中のメールを破棄しますか？（まだ送信されていません）");
  const closeComposeUnlessDocked = () => {
    if (!composeMinimized) setCompose(null);
  };

  const changeFolder = (f: FolderView) => {
    if (!confirmDiscard()) return;
    // Record a history entry so ブラウザの戻る returns to the current folder.
    // A minimized (docked) composer doesn't count as an overlay here.
    const overlayOpen =
      (compose !== null && !composeMinimized) ||
      showSettings ||
      showScheduled ||
      showDrafts ||
      showSweep ||
      selectedId !== null;
    if (!overlayOpen && view === "mail" && f !== folder) {
      folderStack.current.push(folder);
      history.pushState({ asanagiFolder: true }, "");
    }
    setView("mail");
    setFolder(f);
    // Folder clicks must visibly switch even while showing search results.
    setSearchQuery("");
    setSearchResults(null);
    setSelectedId(null);
    setSelected(null);
    setThread(null);
    closeComposeUnlessDocked();
    setChecked(new Set());
  };

  // Sidebar: pick an account AND folder together (folders nested per account).
  // Both state updates are batched → the [folder, account] effect loads once.
  const changeAccountFolder = (key: string, f: FolderView) => {
    if (!confirmDiscard()) return;
    setView("mail");
    setAccount(key);
    setFolder(f);
    setSearchQuery("");
    setSearchResults(null);
    setSelectedId(null);
    setSelected(null);
    setThread(null);
    closeComposeUnlessDocked();
    setChecked(new Set());
  };

  // Poll the scheduler (also flushes any due sends server-side).
  useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch("/api/schedule");
        const data = await res.json();
        setScheduledCount(
          (data.items ?? []).filter(
            (s: { status: string }) => s.status === "scheduled",
          ).length,
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
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}&scope=server`,
      );
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

  // AI検索: 現在のヒット群から「経緯」をAIがまとめる（クリック時だけ＝勝手に課金しない）。
  const runSearchDigest = useCallback(async () => {
    const q = searchQuery.trim();
    const msgs = searchResults;
    if (!q || !msgs?.length) return;
    setSearchDigest("loading");
    try {
      const res = await fetch("/api/ai/search-digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, messages: msgs, locale }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setSearchDigest(data.digest ?? "error");
    } catch {
      setSearchDigest("error");
    }
  }, [searchQuery, searchResults, locale]);

  // 検索語が変われば経緯はやり直し（古い経緯を残さない）。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchDigest(null);
  }, [searchQuery]);

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

  const classify = useCallback(
    async (email: Email) => {
      if (email.importance) return;
      const token = ++classifyToken.current;
      setClassifying(true);
      try {
        const res = await fetch("/api/ai/classify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, locale }),
        });
        const data = await res.json();
        if (token !== classifyToken.current) return; // a newer selection won
        const patch = {
          importance: data.importance as Importance,
          importanceReason: data.reason,
          threat: (data.threat as Email["threat"]) ?? undefined,
        };
        setSelected((s) => (s && s.id === email.id ? { ...s, ...patch } : s));
        setEmails((list) =>
          list.map((e) => (e.id === email.id ? { ...e, ...patch } : e)),
        );
      } finally {
        if (token === classifyToken.current) setClassifying(false);
      }
    },
    [locale],
  );

  // Load the conversation for the opened email. Cache-first (instant, ~20ms)
  // then revalidate live in the background — the live provider.thread() can take
  // ~8s for a big Gmail thread (and IMAP get ~15s), which used to block the
  // whole conversation (rail + cards) from appearing. stale-while-revalidate.
  const loadThread = useCallback(async (email: Email) => {
    const token = ++threadToken.current;
    setThread(null);
    if (!email.account || !email.threadId) return;
    const key = encodeURIComponent(`${email.account}/${email.threadId}`);
    // 1) Cache-first paint — the conversation shows immediately.
    try {
      const cdata = await fetch(`/api/threads/${key}?cached=1`).then((r) =>
        r.json(),
      );
      if (token === threadToken.current && cdata.messages?.length) {
        setThread(cdata.messages);
      }
    } catch {
      /* cache is best-effort — fall through to live */
    }
    // 2) Revalidate live (server-side threading / freshest state) and replace.
    try {
      const res = await fetch(`/api/threads/${key}`);
      const data = await res.json();
      if (token === threadToken.current && data.messages)
        setThread(data.messages);
    } catch {
      /* thread view is progressive enhancement */
    }
  }, []);

  // List-side inline expansion: fetch a thread's members from the local cache
  // (instant, cross-folder — your own sent replies included). Best-effort; an
  // empty result just means the row won't expand.
  const loadThreadMembers = useCallback(
    async (email: Email): Promise<Email[]> => {
      if (!email.account || !email.threadId) return [];
      try {
        const res = await fetch(
          `/api/threads/${encodeURIComponent(`${email.account}/${email.threadId}`)}?cached=1`,
        );
        const data = await res.json();
        return (data.messages as Email[]) ?? [];
      } catch {
        return [];
      }
    },
    [],
  );

  const selectEmail = useCallback(
    async (id: string) => {
      // A docked (minimized) composer stays open while you read other mail;
      // otherwise opening a mail would close the composer, so ask first.
      if (
        compose !== null &&
        !composeMinimized &&
        !window.confirm(
          "作成中のメールを破棄しますか？（まだ送信されていません）",
        )
      )
        return;
      setSelectedId(id);
      if (!composeMinimized) setCompose(null);
      setEmails((list) =>
        list.map((e) => (e.id === id ? { ...e, read: true } : e)),
      );

      const token = ++selectToken.current;
      const enc = encodeURIComponent(id);
      let painted = false;

      // 1) Cache-first paint — instant, no provider round-trip (offline-safe).
      try {
        const cdata = await fetch(`/api/emails/${enc}?cached=1`).then((r) =>
          r.json(),
        );
        if (token === selectToken.current && cdata?.email) {
          setSelected(cdata.email);
          loadThread(cdata.email);
          painted = true;
        }
      } catch {
        /* cache is best-effort — fall through to live */
      }

      // 2) Revalidate live (fresh state / html / read-sync) and replace on land.
      //    The route itself falls back to cache on network error, so offline
      //    still resolves to the cached copy rather than throwing.
      let data: { email?: Email; error?: string; needsReauth?: boolean } = {};
      try {
        data = await fetch(`/api/emails/${enc}`).then((r) => r.json());
      } catch {
        /* offline / network error → keep whatever the cache painted */
      }
      if (token !== selectToken.current) return; // superseded by another open

      if (data.email) {
        setSelected(data.email);
        classify(data.email);
        loadThread(data.email);
        // 一覧を追従: 開いたメールが今の一覧に無く（例: スレッドの「このメールを
        // 開く」でアーカイブ済みを開いた）別フォルダに属するなら、左の一覧を
        // そのフォルダへ切り替える（選択はそのまま＝行が現れてハイライト＋
        // 自動スクロール）。検索中はクロスフォルダ表示なので触らない。
        if (
          searchResults === null &&
          data.email.state !== folder &&
          !emailsRef.current.some((e) => e.id === id)
        ) {
          setFolder(data.email.state);
          loadList(data.email.state, account);
        }
      } else if (!painted) {
        // 何も表示できていない時だけエラー扱い（キャッシュが出ていれば維持）。
        setSelectedId(null);
        showToast(data.error ?? "メールを開けませんでした");
        if (data.needsReauth) setShowSettings(true); // 再認証へ誘導
      }
    },
    [
      classify,
      loadThread,
      compose,
      composeMinimized,
      searchResults,
      folder,
      loadList,
      account,
    ],
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
      // サーバ書き込みの完了 promise を返す（呼び出し側が await すれば反映後に
      // リロードできる。await しない archive/trash 単発は従来どおり即時）。
      showToast(ids.length > 1 ? `${label}（${ids.length}通）` : label);
      // 学習: 受信箱で直接さばいた処分も教師信号にする（朝の一凪ダイアログ以外
      // の操作が今まで学習に反映されていなかった）。ゴミ箱=「低＋ゴミ箱行き」、
      // アーカイブ=「アーカイブ行き」（重要度は変えない＝対応済みの重要メールを
      // 誤って低にしない）。並行PATCHの競合を避けるため1リクエストにまとめる。
      if (state === "archived" || state === "trashed") {
        const senders = [
          ...new Set(
            ids
              .map(
                (id) => emailsRef.current.find((e) => e.id === id)?.from.email,
              )
              .filter((v): v is string => Boolean(v)),
          ),
        ];
        if (senders.length) {
          void fetch("/api/sweep/learn", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              signals: senders.map((fromEmail) =>
                state === "trashed"
                  ? { fromEmail, importance: "low", action: "trash" }
                  : { fromEmail, action: "archive" },
              ),
            }),
          }).catch(() => {});
        }
      }
      return (async () => {
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

  const archive = (ids: string[]) =>
    mutateState(ids, "archived", "アーカイブしました");

  /** 朝の一掃の実行: 推奨ごとにまとめて移動し、スヌーズ時刻を記録。 */
  const applySweep = async (archiveIds: string[], trashIds: string[]) => {
    // await = サーバ反映まで待つ（mutateState が settle promise を返す）。
    if (archiveIds.length)
      await mutateState(archiveIds, "archived", "一凪: アーカイブ");
    if (trashIds.length)
      await mutateState(trashIds, "trashed", "一凪: ゴミ箱へ");
    localStorage.setItem("asanagi:last-sweep", String(Date.now()));
    // 反映後に受信箱を再取得（新着の取り込み＋実状態に同期）。
    if (archiveIds.length || trashIds.length) loadList(folder, account);
  };
  const trash = (ids: string[]) =>
    mutateState(ids, "trashed", "ゴミ箱に移動しました");
  const restore = (ids: string[]) =>
    mutateState(ids, "inbox", "受信箱に戻しました");

  // 迷惑メール報告: 差出人/ドメインを危険として学習し、ゴミ箱へ移動する。
  const reportSpam = async (email: Email) => {
    try {
      await fetch(`/api/emails/${encodeURIComponent(email.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportSpam: { fromEmail: email.from.email } }),
      });
    } catch {
      /* learning is best-effort */
    }
    await mutateState(
      [email.id],
      "trashed",
      "迷惑メールとして報告し、ゴミ箱へ移動しました",
    );
  };

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

  // 検索結果はグルーピングしない（1ヒット=1行）。まとめると代表＝最新メール（＝自分の
  // 返信になりがち）が前面に出て、クリックしたいヒット本体が裏に隠れてしまうため。
  // 「一覧で見えているメール＝クリックで開くメール」の WYSIWYG を検索で担保する。
  // 通常フォルダはトグルどおり会話グルーピング。
  const rows = buildRows(
    searchResults ?? emails,
    searchResults !== null ? false : grouping,
  );

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

  // Shift+click range: add every row between the anchor and the clicked row
  // (連続選択)。EmailList が表示順の id 配列を渡してくる。
  const selectRange = useCallback((ids: string[]) => {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const bulkAct = async (state: MailboxState, label: string) => {
    const ids = rows
      .filter((r) => checked.has(r.email.id))
      .flatMap((r) => r.ids);
    if (!ids.length) return;
    setChecked(new Set());
    await mutateState(ids, state, label);
  };

  // Bulk 迷惑メール報告: report every checked conversation as spam/phishing.
  // Learns once per distinct sender (教師データ) then trashes all of them.
  const bulkReportSpam = async () => {
    const targetRows = rows.filter((r) => checked.has(r.email.id));
    if (!targetRows.length) return;
    const ids = targetRows.flatMap((r) => r.ids);
    // One learning report per distinct sender (representative email id).
    const bySender = new Map<string, Email>();
    for (const r of targetRows) {
      if (!bySender.has(r.email.from.email))
        bySender.set(r.email.from.email, r.email);
    }
    setChecked(new Set());
    await Promise.all(
      Array.from(bySender.values()).map((e) =>
        fetch(`/api/emails/${encodeURIComponent(e.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reportSpam: { fromEmail: e.from.email } }),
        }).catch(() => {}),
      ),
    );
    await mutateState(
      ids,
      "trashed",
      `${targetRows.length}件を迷惑メールとして報告しました`,
    );
  };

  // Mark a set of mails' importance — a per-sender training signal (教師データ)
  // for each, so the AI's future judgments improve. Shared by the conversation
  // bulk bar and the per-message (thread sub-row) selection.
  const importanceForEmails = async (
    targets: Email[],
    importance: Importance,
  ) => {
    if (!targets.length) return;
    setEmails((list) =>
      list.map((e) =>
        targets.some((t) => t.id === e.id) ? { ...e, importance } : e,
      ),
    );
    await Promise.all(
      targets.map((e) =>
        fetch(`/api/emails/${encodeURIComponent(e.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            importanceFeedback: { importance, fromEmail: e.from.email },
          }),
        }).catch(() => {}),
      ),
    );
    const label =
      importance === "high" ? "重要" : importance === "low" ? "低" : "通常";
    showToast(`${targets.length}件を「${label}」として学習しました`);
  };

  // Bulk importance for the checked conversation rows (acts on each 代表=差出人).
  const bulkImportance = async (importance: Importance) => {
    const targets = rows
      .filter((r) => checked.has(r.email.id))
      .map((r) => r.email);
    if (!targets.length) return;
    setChecked(new Set());
    await importanceForEmails(targets, importance);
  };

  /** Star toggle — optimistic UI, server-synced (Gmail STARRED / IMAP \Flagged). */
  const toggleStar = useCallback(
    async (id: string) => {
      const target =
        emails.find((e) => e.id === id) ??
        (selected?.id === id ? selected : null);
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
        setEmails((list) =>
          list.map((e) => (e.id === id ? { ...e, starred: !next } : e)),
        );
        setSelected((s) => (s && s.id === id ? { ...s, starred: !next } : s));
        showToast("スターの更新に失敗しました");
      }
    },
    [emails, selected, folder],
  );

  /** Mark an (already-read) mail back to unread — optimistic, server-synced. */
  const markUnread = useCallback(async (id: string) => {
    setEmails((list) =>
      list.map((e) => (e.id === id ? { ...e, read: false } : e)),
    );
    setSelected((s) => (s && s.id === id ? { ...s, read: false } : s));
    try {
      const res = await fetch(`/api/emails/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read: false }),
      });
      if (!res.ok) throw new Error();
      showToast("未読に戻しました");
    } catch {
      setEmails((list) =>
        list.map((e) => (e.id === id ? { ...e, read: true } : e)),
      );
      setSelected((s) => (s && s.id === id ? { ...s, read: true } : s));
      showToast("未読への変更に失敗しました");
    }
  }, []);

  const onImportanceFeedback = async (importance: Importance) => {
    if (!selected) return;
    setSelected({
      ...selected,
      importance,
      importanceReason: "あなたが指定した重要度です。",
    });
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

  /** Open the composer with a prepared initial state. `target` overrides the
   *  reply source — so a per-message 返信 in the thread replies to THAT message
   *  (In-Reply-To = its Message-ID), not just whatever is anchored. */
  const openCompose = useCallback(
    async (kind: ComposeKind, mode: ComposeAI, target?: Email) => {
      const src = target ?? selected;
      if (kind !== "new" && !src) return;
      // Starting a new compose while one is open would replace the draft.
      // (confirm stays synchronous — before any await — to keep the intent clear.)
      if (
        compose !== null &&
        !window.confirm(
          "作成中のメールを破棄しますか？（まだ送信されていません）",
        )
      )
        return;
      const selfAddresses = accounts
        .map((a) => a.address)
        .filter((s): s is string => !!s);
      // 宛名整形: プレーン返信/全返信は、相手の連絡先メタ（会社名・敬称）を引いて
      // 「会社名 / 担当者様」の宛名にする。AIモードは本文をAIが書くので対象外。
      let recipientMeta: RecipientMeta | undefined;
      if (mode === "plain" && (kind === "reply" || kind === "replyAll")) {
        const gt = greetTargetOf(kind, src ?? undefined, selfAddresses);
        if (gt?.email) {
          try {
            const r = await fetch(
              `/api/contacts/meta?email=${encodeURIComponent(gt.email)}`,
            );
            const d = (await r.json()) as {
              resolved?: { company?: string; honorific?: string };
            };
            const m = d.resolved;
            if (m && (m.company || m.honorific)) {
              recipientMeta = { company: m.company, honorific: m.honorific };
            }
          } catch {
            /* fall back to the default「様」salutation */
          }
        }
      }
      const init = buildCompose(
        kind,
        mode,
        src ?? undefined,
        selfAddresses,
        recipientMeta,
      );
      // New mail from a specific account view sends from that account.
      if (kind === "new" && account !== "all") init.account = account;
      // Conversation so far → AI drafting context (agreed dates, open points).
      if (kind !== "new" && thread && thread.length > 1) init.history = thread;
      startCompose(init);
    },
    [selected, accounts, account, thread, compose],
  );

  /** Reply/forward to a specific thread message (per-message action buttons). */
  const replyToMessage = useCallback(
    (id: string, kind: ComposeKind, mode: ComposeAI) => {
      const m =
        thread?.find((x) => x.id === id) ??
        (selected?.id === id ? selected : undefined);
      openCompose(kind, mode, m ?? undefined);
    },
    [thread, selected, openCompose],
  );

  const onSent = (kind: "sent" | "scheduled") => {
    const wasReply = compose?.kind === "reply" || compose?.kind === "replyAll";
    const fromDraft = compose?.draftId != null;
    setCompose(null);
    if (wasReply && selected && folder === "inbox") {
      // Send & archive — keep the inbox clean (replies only; not forward/new).
      mutateState(
        [selected.id],
        "archived",
        kind === "sent"
          ? "送信してアーカイブしました"
          : "予約してアーカイブしました",
      );
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
    startCompose({
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
      attachments: d.attachments,
      html: d.html,
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
        selectEmail(
          rows[Math.min(rows.length - 1, idx + 1)]?.email.id ??
            rows[0].email.id,
        );
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
      } else if (
        e.key === "e" &&
        rowIds.length &&
        folder !== "archived" &&
        folder !== "sent"
      ) {
        archive(rowIds);
      } else if (
        (e.key === "#" || e.key === "Backspace") &&
        rowIds.length &&
        folder !== "trashed"
      ) {
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

  // Defined once, placed differently per layout: classic = 一覧(左)｜本文(右)、
  // geek = 一覧(上)｜本文(下)。EmailList adapts via horizontal/width/height.
  // 下書きの紐付け: 会話(threadId)単位で「この会話に下書きあり」を判定。
  const draftThreadIds = new Set(
    drafts.map((d) => d.threadId).filter((x): x is string => Boolean(x)),
  );
  const matchingDraft = selected?.threadId
    ? drafts.find((d) => d.threadId === selected.threadId)
    : undefined;

  const emailListEl = (
    <EmailList
      folder={folder}
      rows={rows}
      loading={loading && searchResults === null}
      refreshing={refreshing && searchResults === null}
      selectedId={selectedId}
      searchQuery={searchQuery}
      searching={searchResults !== null}
      searchError={searchError}
      searchMode={searchMode}
      onSetSearchMode={setSearchMode}
      searchDigest={searchDigest}
      onRunSearchDigest={runSearchDigest}
      searchCorpus={searchResults ?? []}
      grouping={grouping}
      groupAxis={groupAxis}
      noteIds={noteIds}
      contactLabel={contactLabel}
      draftThreadIds={draftThreadIds}
      onChangeGroupAxis={changeGroupAxis}
      accountLabels={
        accounts.length > 1 && (account === "all" || searchResults !== null)
          ? Object.fromEntries(
              accounts.map((a) => [a.key, a.address ?? a.label]),
            )
          : null
      }
      serverSearched={serverSearched}
      serverSearching={serverSearching}
      checkedIds={checked}
      onToggleCheck={toggleChecked}
      onSelectRange={selectRange}
      onCheckAll={() => setChecked(new Set(rows.map((r) => r.email.id)))}
      onClearChecked={() => setChecked(new Set())}
      onBulkArchive={() => bulkAct("archived", "一括アーカイブしました")}
      onBulkTrash={() => bulkAct("trashed", "一括でゴミ箱に移動しました")}
      onBulkReportSpam={bulkReportSpam}
      onBulkImportance={bulkImportance}
      onImportanceFor={importanceForEmails}
      onServerSearch={searchServer}
      onSearchChange={setSearchQuery}
      onToggleGrouping={toggleGrouping}
      onSelect={selectEmail}
      onLoadThreadMembers={loadThreadMembers}
      onArchive={archive}
      onTrash={trash}
      onToggleStar={toggleStar}
      onRefresh={() => loadList(folder, account)}
      agedDraftCount={agedDraftCount}
      onOpenDrafts={() => setShowDrafts(true)}
      width={listWidth}
      horizontal={layout === "geek"}
      height={listHeight}
    />
  );
  const readerEl = (
    <EmailReader
      email={selected}
      thread={thread}
      folder={folder}
      classifying={classifying}
      onArchive={() => selected && archive([selected.id])}
      onTrash={() => selected && trash([selected.id])}
      onRestore={() => selected && restore([selected.id])}
      onReply={openCompose}
      onReplyMessage={replyToMessage}
      onToggleStar={() => selected && toggleStar(selected.id)}
      onMarkUnread={() => selected && markUnread(selected.id)}
      senderLabel={
        selected
          ? contactLabel(
              selected.state === "sent" && selected.to[0]
                ? selected.to[0].email
                : selected.from.email,
            )
          : undefined
      }
      onImportanceFeedback={onImportanceFeedback}
      onReportSpam={() => selected && reportSpam(selected)}
      onNoteSaved={loadNoteIds}
      highlight={searchResults !== null ? searchQuery : undefined}
      onOpenMessage={selectEmail}
      draft={matchingDraft}
      onResumeDraft={openDraft}
    />
  );

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
        onSelectAccountFolder={changeAccountFolder}
        onOpenSettings={() => setShowSettings(true)}
        onOpenScheduled={() => setShowScheduled(true)}
        onOpenDrafts={() => setShowDrafts(true)}
        onOpenSweep={() => setShowSweep(true)}
        onCompose={() => openCompose("new", "plain")}
        layout={layout}
        onSetLayout={setLayoutMode}
      />
      {view === "contacts" && (!compose || composeMinimized) && (
        <ContactsView
          onComposeTo={(to: EmailAddress) =>
            startCompose({
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
      {view === "triage" && (!compose || composeMinimized) && <TriageView />}
      {view === "ailog" && (!compose || composeMinimized) && <AiLogView />}
      {view === "projects" && (!compose || composeMinimized) && (
        <ProjectsView
          onOpenEmail={(id) => {
            setView("mail");
            void selectEmail(id);
          }}
        />
      )}
      {/* classic: 一覧(左)｜本文(右)・幅ドラッグ可変 */}
      {view === "mail" && layout === "classic" && (
        <>
          {(!replying || composeMinimized) && emailListEl}
          {(!replying || composeMinimized) &&
            (!compose || composeMinimized) && (
              <ResizeHandle onResize={resizeList} />
            )}
          {(!compose || composeMinimized) && readerEl}
        </>
      )}
      {/* geek: 一覧(上・件名がずらり)｜本文(下)・高さドラッグ可変。返信中(占有)は
          この段を退避し composer が受け持つ（v1）。 */}
      {view === "mail" &&
        layout === "geek" &&
        (!replying || composeMinimized) && (
          <div className="flex min-w-0 flex-1 flex-col">
            {emailListEl}
            <ResizeHandle
              orientation="horizontal"
              onResize={resizeListHeight}
            />
            {(!compose || composeMinimized) && readerEl}
          </div>
        )}
      {/* Composer: stays mounted while minimized so the draft is preserved. */}
      {compose && (
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
          minimized={composeMinimized}
          onMinimize={() => setComposeMinimized(true)}
          onRestore={() => setComposeMinimized(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-slide-up rounded-full bg-fg px-4 py-2 text-sm text-bg shadow-[var(--shadow)]">
          {toast}
        </div>
      )}

      {showSweep && (
        <SweepDialog
          emails={emails}
          accountLabels={
            // どのアカウントのメールかを行ごとに表示（複数アカウント接続時のみ）。
            accounts.length > 1
              ? Object.fromEntries(
                  accounts.map((a) => [a.key, a.address ?? a.label]),
                )
              : null
          }
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
      <ScheduledPanel
        open={showScheduled}
        onClose={() => setShowScheduled(false)}
      />
      <DraftsPanel
        open={showDrafts}
        onClose={() => setShowDrafts(false)}
        onOpenDraft={openDraft}
        onChanged={loadDraftsCount}
      />
    </div>
  );
}
