"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Trash2,
  Loader2,
  Inbox,
  Layers,
  NotebookPen,
  Paperclip,
  PenLine,
  RefreshCw,
  Reply,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Email, FolderView, Importance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { avatarColor, initials, relativeTime } from "./helpers";
import type { ThreadRow } from "./threadList";
import type { SearchDigest } from "@/app/api/ai/search-digest/route";

export type SearchMode = "keyword" | "ai";

/** 一覧のグループ化軸（折りたたみセクション）。 */
export type GroupAxis = "none" | "account" | "sender";

/** メールアドレスのドメイン部（送信者グループのキー）。 */
function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : email.toLowerCase();
}

/** Search keywords, parsed the same way db.searchCached does (space = AND). */
function searchTerms(query?: string): string[] {
  return (query ?? "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Mark the matched keywords inside a result's text (highlighter look). */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>;
  // One capture group around the alternation → split() alternates text/match.
  const parts = text.split(
    new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi"),
  );
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="rounded-sm bg-amber-200/80 px-0.5 text-fg dark:bg-amber-400/30"
          >
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Preview line for a search hit: the normal snippet when the keyword is already
 * visible there, otherwise a window cut from around the FIRST body match — so a
 * "本文" hit shows *where* in the body it matched instead of just the opening
 * 140 chars (which often don't contain the keyword at all).
 */
function previewFor(email: Email, terms: string[]): string {
  const base = email.snippet ?? "";
  if (!terms.length) return base;
  const lowBase = base.toLowerCase();
  if (terms.some((t) => lowBase.includes(t.toLowerCase()))) return base; // already visible
  const body = email.body ?? "";
  const lowBody = body.toLowerCase();
  let at = -1;
  let len = 0;
  for (const t of terms) {
    const i = lowBody.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      len = t.length;
    }
  }
  if (at < 0) return base; // hit was elsewhere (件名/差出人/宛先)
  const start = Math.max(0, at - 40);
  const end = Math.min(body.length, at + len + 60);
  const cut = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${cut}${end < body.length ? "…" : ""}`;
}

/**
 * Which field(s) the search hit — mirrors db.searchCached (each keyword may hit
 * any field; a field is "hit" when it contains any keyword). Shown as badges so
 * it's obvious WHY a result matched (件名 / 本文 / 差出人 / 宛先).
 */
function matchedFields(email: Email, query?: string): string[] {
  const terms = searchTerms(query).map((t) => t.toLowerCase());
  if (!terms.length) return [];
  const hit = (hay: string) => {
    const h = hay.toLowerCase();
    return terms.some((t) => h.includes(t));
  };
  const people = (list?: { name?: string; email: string }[]) =>
    (list ?? []).map((a) => `${a.name ?? ""} ${a.email}`).join(" ");
  // Returns match-field KEYS (translated at render via t(`match.${k}`)).
  const out: string[] = [];
  if (hit(email.subject)) out.push("subject");
  if (hit(email.body)) out.push("body");
  if (hit(`${email.from.name ?? ""} ${email.from.email}`)) out.push("from");
  if (hit(`${people(email.to)} ${people(email.cc)}`)) out.push("to");
  return out;
}

/** rows を選択軸でセクションに束ねる。各セクションは元の日付順を保つ。 */
function buildSections(
  rows: ThreadRow[],
  axis: GroupAxis,
  accountLabels: Record<string, string> | null,
  unknownLabel: string,
): { key: string; label: string; rows: ThreadRow[] }[] {
  if (axis === "none") return [{ key: "_all", label: "", rows }];
  const map = new Map<
    string,
    { key: string; label: string; rows: ThreadRow[] }
  >();
  for (const r of rows) {
    let key: string;
    let label: string;
    if (axis === "account") {
      key = r.email.account ?? "";
      label = (accountLabels && accountLabels[key]) || key || unknownLabel;
    } else {
      key = domainOf(r.email.from.email);
      label = key || unknownLabel;
    }
    const sec = map.get(key);
    if (sec) sec.rows.push(r);
    else map.set(key, { key, label, rows: [r] });
  }
  // 最新メールを含むグループを上に。
  return [...map.values()].sort(
    (a, b) => +new Date(b.rows[0].email.date) - +new Date(a.rows[0].email.date),
  );
}

export function EmailList({
  folder,
  rows,
  loading,
  refreshing,
  searchError,
  selectedId,
  searchQuery,
  searching,
  searchMode,
  onSetSearchMode,
  searchDigest,
  onRunSearchDigest,
  searchCorpus,
  grouping,
  groupAxis,
  noteIds,
  draftThreadIds,
  onChangeGroupAxis,
  serverSearched,
  serverSearching,
  accountLabels,
  checkedIds,
  onToggleCheck,
  onSelectRange,
  onCheckAll,
  onClearChecked,
  onBulkArchive,
  onBulkTrash,
  onBulkReportSpam,
  onBulkImportance,
  onImportanceFor,
  onSearchChange,
  onServerSearch,
  onToggleGrouping,
  onSelect,
  onLoadThreadMembers,
  onArchive,
  onTrash,
  onToggleStar,
  onRefresh,
  agedDraftCount,
  onOpenDrafts,
  width,
  horizontal,
  height,
}: {
  folder: FolderView;
  /** Conversation rows (1 row = 1 conversation when grouping is on). */
  rows: ThreadRow[];
  loading: boolean;
  /** Live revalidation in flight (content already on screen from cache).
   *  Distinct from `loading` (initial skeleton) so the refresh gives feedback. */
  refreshing: boolean;
  /** The last search request failed (vs 0 hits) → show an error, not「該当なし」. */
  searchError?: boolean;
  selectedId: string | null;
  /** Current search box value; non-empty switches the list to results. */
  searchQuery: string;
  /** True while the list shows search results instead of the folder. */
  searching: boolean;
  /** 検索モード: keyword=一覧絞り込み / ai=ヒット群から経緯をまとめる。 */
  searchMode: SearchMode;
  onSetSearchMode: (m: SearchMode) => void;
  /** AI検索の経緯（"loading"/"error"/結果/null）。 */
  searchDigest: "loading" | "error" | SearchDigest | null;
  /** ヒット群から経緯をまとめる（AIモードのボタン）。 */
  onRunSearchDigest: () => void;
  /** 検索ヒット全件（flat）— 根拠メールの件名引き用（スレッド集約の裏も引ける）。 */
  searchCorpus: Email[];
  /** スレッド表示（1会話=1行）が有効か。検索結果では常に個別表示。 */
  grouping: boolean;
  /** セクション分けの軸（なし/アカウント別/送信者ドメイン別）。 */
  groupAxis: GroupAxis;
  /** 自分用メモがあるメールIDの集合（📝インジケータ用）。 */
  noteIds: Set<string>;
  /** 下書きが紐づく会話(threadId)の集合（✏️インジケータ用）。 */
  draftThreadIds: Set<string>;
  onChangeGroupAxis: (axis: GroupAxis) => void;
  /** 今回の検索語でサーバ全履歴検索を実行済みか（#40）。 */
  serverSearched: boolean;
  serverSearching: boolean;
  /** account key → short label; non-null shows the origin badge per row
   *  (unified inbox / search across multiple accounts). */
  accountLabels: Record<string, string> | null;
  /** Bulk selection — row representative ids currently checked. */
  checkedIds: Set<string>;
  onToggleCheck: (repId: string) => void;
  /** Shift+click 連続選択: アンカー〜クリック行の id をまとめて選択に加える。 */
  onSelectRange: (repIds: string[]) => void;
  onCheckAll: () => void;
  onClearChecked: () => void;
  onBulkArchive: () => void;
  onBulkTrash: () => void;
  /** Report all checked mails as spam/phishing (learns per sender + trashes). */
  onBulkReportSpam: () => void;
  /** Mark all checked mails' importance (重要/通常/低) — AI 学習シグナル. */
  onBulkImportance: (importance: Importance) => void;
  /** Mark specific mails' importance — for per-message (thread sub-row) selection. */
  onImportanceFor: (emails: Email[], importance: Importance) => void;
  onSearchChange: (q: string) => void;
  onServerSearch: () => void;
  onToggleGrouping: () => void;
  onSelect: (id: string) => void;
  /** Inline thread expansion: fetch a conversation's members (cache-first,
   *  cross-folder). Returns [] when there's nothing to show. */
  onLoadThreadMembers: (email: Email) => Promise<Email[]>;
  /** Thread-unit: every id of the row (1 element when not grouped). */
  onArchive: (ids: string[]) => void;
  onTrash: (ids: string[]) => void;
  onToggleStar: (id: string) => void;
  onRefresh: () => void;
  /** Count of unsent drafts left untouched for several days (aged-draft reminder). */
  agedDraftCount: number;
  /** Open the drafts panel (from the reminder banner). */
  onOpenDrafts: () => void;
  /** Pixel width for the list pane (classic left column). Omit → fixed 384px. */
  width?: number;
  /** Geek layout: render as a full-width TOP pane (件名がずらり) instead of a
   *  left column. Height comes from `height`. */
  horizontal?: boolean;
  /** Pixel height when `horizontal` (geek top pane). */
  height?: number;
}) {
  const { t } = useI18n();
  const selectionActive = checkedIds.size > 0;
  // List zoom (行/文字の拡大率) — a lasting per-viewer preference, applied via CSS
  // `zoom` on the rows container so padding scales too (true density change).
  // WebKit(Linux webview) and Chromium both support `zoom`.
  const [listZoom, setListZoom] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem("asanagi:list-zoom") ?? "");
      return v >= 0.8 && v <= 1.4 ? v : 1;
    } catch {
      return 1;
    }
  });
  const setZoom = (z: number) => {
    const clamped = Math.min(1.4, Math.max(0.8, Math.round(z * 10) / 10));
    setListZoom(clamped);
    try {
      localStorage.setItem("asanagi:list-zoom", String(clamped));
    } catch {
      /* per-viewer convenience only */
    }
  };
  // Aged-draft reminder: dismissible, and the dismissal only lasts the day so it
  // gently resurfaces each morning (local-first — the flag never leaves the device).
  const today = new Date().toISOString().slice(0, 10);
  const [draftReminderHidden, setDraftReminderHidden] = useState(() => {
    // Client-only component, so read storage once at mount (empty = show).
    try {
      return localStorage.getItem("asanagi:draft-reminder-dismissed") === today;
    } catch {
      return false;
    }
  });
  const showDraftReminder =
    !searching &&
    folder === "inbox" &&
    agedDraftCount > 0 &&
    !draftReminderHidden;
  const dismissDraftReminder = () => {
    setDraftReminderHidden(true);
    try {
      localStorage.setItem("asanagi:draft-reminder-dismissed", today);
    } catch {
      /* best-effort */
    }
  };
  // 折りたたんだセクションのキー（軸ごとに保持）。
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 検索結果は横断のため軸グループ化しない（特定の1通を探す行為）。
  const effectiveAxis: GroupAxis = searching ? "none" : groupAxis;
  const sections = buildSections(
    rows,
    effectiveAxis,
    accountLabels,
    t("group.unknown"),
  );
  // Shift+click 連続選択のアンカー（直前に触れた行の rep id）。
  const anchorRef = useRef<string | null>(null);
  // 表示順の rep id 列（範囲計算用。セクション表示でも見えている順に並べる）。
  const orderedIds = (
    effectiveAxis === "none" ? rows : sections.flatMap((s) => s.rows)
  ).map((r) => r.email.id);
  // 通常クリック=トグル、Shift+クリック=アンカーからの範囲を選択に加える。
  const handleToggleCheck = (id: string, shiftKey: boolean) => {
    const anchor = anchorRef.current;
    if (shiftKey && anchor && anchor !== id) {
      const a = orderedIds.indexOf(anchor);
      const b = orderedIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        onSelectRange(orderedIds.slice(lo, hi + 1));
        anchorRef.current = id;
        return;
      }
    }
    onToggleCheck(id);
    anchorRef.current = id;
  };
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Inline thread expansion (一覧側で全体像): a grouped row can unfold its whole
  // conversation as compact sub-rows, without leaving the list. Members are
  // fetched cache-first (instant, cross-folder) and memoized per rep id.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Record<string, Email[]>>({});
  // Per-message selection inside an expanded conversation (individual mails).
  // Distinct from the row-level `checkedIds` (whole conversations), so you can
  // act on just one inquiry of a same-subject group (e.g. お問い合わせ 4通).
  const [subChecked, setSubChecked] = useState<Set<string>>(new Set());
  const toggleSubCheck = (id: string) =>
    setSubChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleExpand = (row: ThreadRow) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(row.email.id)) next.delete(row.email.id);
      else next.add(row.email.id);
      return next;
    });
    if (!members[row.email.id]) {
      onLoadThreadMembers(row.email).then((ms) =>
        // Oldest→newest so the sub-rows read as a timeline.
        setMembers((prev) => ({
          ...prev,
          [row.email.id]: [...ms].sort(
            (a, b) => +new Date(a.date) - +new Date(b.date),
          ),
        })),
      );
    }
  };

  const renderRow = (row: ThreadRow) => {
    // Expansion only makes sense for real conversations while grouped, and not
    // in search (already 1-hit-per-row). Works in both layouts (左右/上下).
    // threadTotal (cache, cross-folder) can exceed the loaded member count, so a
    // lone inbox mail that's part of a bigger thread is expandable too.
    const canExpand = grouping && row.threadTotal > 1 && !searching;
    const isExpanded = canExpand && expanded.has(row.email.id);
    const subs = members[row.email.id];
    const terms = searching ? searchTerms(searchQuery) : [];
    return (
      <Fragment key={row.email.id}>
        <EmailListItem
          row={row}
          dense={horizontal} // 上下表示の上ペインは1行の密行で件数を稼ぐ
          matchQuery={searching ? searchQuery : undefined}
          active={selectedId != null && row.ids.includes(selectedId)}
          folder={folder}
          hasNote={noteIds.has(row.email.id)}
          hasDraft={draftThreadIds.has(row.email.threadId)}
          checked={checkedIds.has(row.email.id)}
          selectionActive={selectionActive}
          expandable={canExpand}
          expanded={isExpanded}
          onToggleExpand={() => toggleExpand(row)}
          accountLabel={
            accountLabels && row.email.account
              ? (accountLabels[row.email.account] ?? row.email.account)
              : null
          }
          onSelect={() => onSelect(row.email.id)}
          onToggleCheck={(shiftKey) =>
            handleToggleCheck(row.email.id, shiftKey)
          }
          onArchive={() => onArchive(row.ids)}
          onTrash={() => onTrash(row.ids)}
          onToggleStar={() => onToggleStar(row.email.id)}
        />
        {isExpanded && (
          <div className="mb-1 ml-6 flex flex-col border-l border-border pl-1">
            {subs === undefined ? (
              <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-fg-subtle">
                <Loader2 className="size-3.5 animate-spin" />
                {t("list.thread.loading")}
              </div>
            ) : subs.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-fg-subtle">
                {t("list.thread.empty")}
              </p>
            ) : (
              (() => {
                // This expansion's selected members (per-message actions).
                const picked = subs.filter((m) => subChecked.has(m.id));
                const clearPicked = () =>
                  setSubChecked((prev) => {
                    const next = new Set(prev);
                    for (const m of subs) next.delete(m.id);
                    return next;
                  });
                return (
                  <>
                    {picked.length > 0 && (
                      <SubActionBar
                        count={picked.length}
                        folder={folder}
                        onClear={clearPicked}
                        onArchive={() => {
                          onArchive(picked.map((m) => m.id));
                          clearPicked();
                        }}
                        onTrash={() => {
                          onTrash(picked.map((m) => m.id));
                          clearPicked();
                        }}
                        onImportance={(imp) => {
                          onImportanceFor(picked, imp);
                          clearPicked();
                        }}
                      />
                    )}
                    {subs.map((m) => (
                      <ThreadMemberRow
                        key={m.id}
                        email={m}
                        active={selectedId === m.id}
                        terms={terms}
                        checked={subChecked.has(m.id)}
                        selectionActive={picked.length > 0}
                        onToggleCheck={() => toggleSubCheck(m.id)}
                        onClick={() => onSelect(m.id)}
                      />
                    ))}
                  </>
                );
              })()
            )}
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <div
      style={horizontal ? { height } : width ? { width } : undefined}
      className={cn(
        "flex shrink-0 flex-col bg-surface",
        horizontal
          ? "w-full border-b border-border" // geek: top pane, full width
          : width
            ? "border-r border-border"
            : "w-[384px] border-r border-border",
      )}
    >
      {selectionActive ? (
        // Bulk action bar — replaces the header while rows are checked.
        <header className="flex flex-wrap items-center gap-1.5 px-4 pb-2 pt-5">
          <button
            onClick={onClearChecked}
            title={t("bulk.clear")}
            className="grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
          <span className="text-sm font-semibold tabular-nums">
            {checkedIds.size}
            {t("bulk.selectedSuffix")}
          </span>
          <button
            onClick={onCheckAll}
            className="rounded-md px-1.5 py-0.5 text-xs text-accent hover:bg-accent-soft"
          >
            {t("bulk.selectAll")}
          </button>
          {/* 重要度を一括学習（AI教師データ）: 選択メールの差出人ごとに学習シグナルを送る。 */}
          <span
            className="ml-1 flex items-center gap-0.5 rounded-lg border border-border p-0.5"
            title={t("bulk.importance.hint")}
          >
            <button
              onClick={() => onBulkImportance("high")}
              className="rounded-md px-1.5 py-1 text-[11px] font-medium text-high hover:bg-high-soft"
            >
              {t("importance.high")}
            </button>
            <button
              onClick={() => onBulkImportance("normal")}
              className="rounded-md px-1.5 py-1 text-[11px] text-fg-muted hover:bg-surface-2"
            >
              {t("importance.normal")}
            </button>
            <button
              onClick={() => onBulkImportance("low")}
              className="rounded-md px-1.5 py-1 text-[11px] text-fg-subtle hover:bg-surface-2"
            >
              {t("importance.low")}
            </button>
          </span>
          <span className="ml-auto flex items-center gap-1">
            {folder !== "archived" && folder !== "sent" && (
              <button
                onClick={onBulkArchive}
                title={t("bulk.archive.title")}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent"
              >
                <Archive className="size-3.5" />
                {t("action.archive")}
              </button>
            )}
            {folder !== "sent" && (
              <button
                onClick={onBulkReportSpam}
                title={t("bulk.reportSpam.title")}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-high hover:text-high"
              >
                <ShieldAlert className="size-3.5" />
                {t("bulk.reportSpam")}
              </button>
            )}
            {folder !== "trashed" && (
              <button
                onClick={onBulkTrash}
                title={t("bulk.trash.title")}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-high hover:text-high"
              >
                <Trash2 className="size-3.5" />
                {t("action.trash")}
              </button>
            )}
          </span>
        </header>
      ) : (
        <header className="flex items-center gap-2 px-5 pb-2 pt-5">
          <h1 className="text-base font-semibold tracking-tight">
            {searching ? t("list.searchResults") : t(`folder.${folder}`)}
          </h1>
          {!searching && (
            <>
              <button
                onClick={onRefresh}
                disabled={loading || refreshing}
                title={t("list.refresh")}
                className="grid size-6 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
              >
                <RefreshCw
                  className={cn(
                    "size-3.5",
                    (loading || refreshing) && "animate-spin",
                  )}
                />
              </button>
              {refreshing && (
                <span
                  className="flex items-center text-[11px] text-fg-subtle"
                  aria-live="polite"
                >
                  {t("list.refreshing")}
                </span>
              )}
              <button
                onClick={onToggleGrouping}
                title={grouping ? t("list.thread.on") : t("list.thread.off")}
                className={cn(
                  "grid size-6 place-items-center rounded-md transition-colors hover:bg-surface-2",
                  grouping ? "text-accent" : "text-fg-subtle hover:text-fg",
                )}
              >
                <Layers className="size-3.5" />
              </button>
              {rows.length > 0 && (
                <button
                  onClick={onCheckAll}
                  title={t("list.selectAll.title")}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-fg-subtle transition-colors hover:bg-surface-2 hover:text-accent"
                >
                  <span className="grid size-3.5 place-items-center rounded-[3px] border border-current" />
                  {t("list.select")}
                </button>
              )}
            </>
          )}
          {/* 一覧の拡大率: 行/文字サイズを調整（端末ごとに保持）。 */}
          <span className="ml-auto flex items-center gap-0.5">
            <button
              onClick={() => setZoom(listZoom - 0.1)}
              disabled={listZoom <= 0.8}
              title={t("list.zoom.out")}
              className="grid size-6 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <button
              onClick={() => setZoom(1)}
              title={t("list.zoom.reset")}
              className="min-w-9 rounded-md px-1 text-[11px] tabular-nums text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
            >
              {Math.round(listZoom * 100)}%
            </button>
            <button
              onClick={() => setZoom(listZoom + 0.1)}
              disabled={listZoom >= 1.4}
              title={t("list.zoom.in")}
              className="grid size-6 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            >
              <ZoomIn className="size-3.5" />
            </button>
          </span>
          <span className="text-xs text-fg-subtle">
            {rows.length}
            {t("list.countSuffix")}
          </span>
        </header>
      )}

      {/* Search across the local cache (all accounts & folders). */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 focus-within:border-accent">
          <Search className="size-3.5 shrink-0 text-fg-subtle" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("search.placeholder")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              title={t("search.clear")}
              className="grid size-5 shrink-0 place-items-center rounded text-fg-subtle hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {/* 検索モード: キーワード（一覧絞り込み）/ AI（経緯をまとめる）。 */}
        {searchQuery.trim() && (
          <div className="mt-2 flex w-fit rounded-lg border border-border p-0.5 text-xs">
            {(["keyword", "ai"] as SearchMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => onSetSearchMode(mode)}
                aria-pressed={searchMode === mode}
                title={t(`search.mode.${mode}.title`)}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors",
                  searchMode === mode
                    ? "bg-accent-soft text-accent"
                    : "text-fg-subtle hover:text-fg",
                )}
              >
                {mode === "ai" && <Sparkles className="size-3" />}
                {t(`search.mode.${mode}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* グループ化軸: なし / アカウント別 / 送信者ドメイン別（折りたたみ表示）。 */}
      {!searching && (
        <div className="flex items-center gap-1.5 px-4 pb-2 text-[11px] text-fg-subtle">
          <span>{t("group.label")}</span>
          {(["none", "account", "sender"] as GroupAxis[]).map((a) => (
            <button
              key={a}
              onClick={() => onChangeGroupAxis(a)}
              className={cn(
                "rounded-md border px-2 py-0.5 transition-colors",
                groupAxis === a
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border hover:border-accent hover:text-accent",
              )}
            >
              {t(`group.${a}`)}
            </button>
          ))}
        </div>
      )}

      {/* Aged-draft reminder — old unsent drafts, surfaced at the top of the inbox. */}
      {showDraftReminder && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <PenLine className="size-3.5 shrink-0" />
          <button
            onClick={onOpenDrafts}
            className="min-w-0 flex-1 text-left hover:underline"
            title={t("list.draftReminder.open")}
          >
            {t("list.draftReminder").replace("{n}", String(agedDraftCount))}
          </button>
          <button
            onClick={dismissDraftReminder}
            title={t("list.draftReminder.dismiss")}
            className="grid size-5 shrink-0 place-items-center rounded text-amber-700/70 hover:bg-amber-500/20 hover:text-amber-800 dark:text-amber-300/70 dark:hover:text-amber-200"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto px-2 pb-4"
        style={listZoom !== 1 ? { zoom: listZoom } : undefined}
      >
        {/* AI検索: ヒット群からまとめた「経緯」を一覧の上に。根拠メールは下にずらり。 */}
        {searching && searchMode === "ai" && (
          <SearchDigestPanel
            digest={searchDigest}
            hitCount={rows.length}
            onRun={onRunSearchDigest}
            onSelect={onSelect}
            emailById={
              new Map(
                // ヒット全件（flat）優先で索引。無ければ代表行から補完。
                [...rows.map((r) => r.email), ...searchCorpus].map((e) => [
                  e.id,
                  e,
                ]),
              )
            }
          />
        )}
        {loading ? (
          <div className="grid h-40 place-items-center text-fg-subtle">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="grid h-60 place-items-center px-6 text-center">
            <div className="flex flex-col items-center gap-2 text-fg-subtle">
              <Inbox className="size-8 opacity-50" />
              <p className="text-sm">
                {searching && searchError
                  ? t("empty.searchFailed")
                  : searching
                    ? serverSearched
                      ? t("empty.serverSearched")
                      : t("empty.searchLocal")
                    : folder === "inbox"
                      ? t("empty.inboxClean")
                      : t("empty.folder")}
              </p>
              {searching && !serverSearched && (
                <ServerSearchButton
                  searching={serverSearching}
                  onClick={onServerSearch}
                />
              )}
            </div>
          </div>
        ) : effectiveAxis === "none" ? (
          rows.map(renderRow)
        ) : (
          sections.map((sec) => {
            const isCollapsed = collapsed.has(sec.key);
            return (
              <div key={sec.key} className="mb-1">
                <button
                  onClick={() => toggleSection(sec.key)}
                  className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-surface/95 px-2 py-1.5 text-left text-xs font-medium text-fg-muted backdrop-blur hover:text-fg"
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{sec.label}</span>
                  <span className="shrink-0 tabular-nums text-fg-subtle">
                    {sec.rows.length}
                  </span>
                </button>
                {!isCollapsed && sec.rows.map(renderRow)}
              </div>
            );
          })
        )}
        {/* Deep dig (#40): widen the cache results to the providers' full
            history — on demand only, so routine searches stay local-first. */}
        {searching && rows.length > 0 && !loading && (
          <div className="flex justify-center py-3">
            {serverSearched ? (
              <span className="text-[11px] text-fg-subtle">
                {t("server.result")}
              </span>
            ) : (
              <ServerSearchButton
                searching={serverSearching}
                onClick={onServerSearch}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 「サーバ全履歴を検索」— Gmail検索演算子（from: before: 等）も使える。 */
function ServerSearchButton({
  searching,
  onClick,
}: {
  searching: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      disabled={searching}
      title={t("server.search.title")}
      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
    >
      {searching ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Search className="size-3.5" />
      )}
      {searching ? t("server.searching") : t("server.search")}
    </button>
  );
}

/**
 * AI検索の「経緯」パネル（一覧の上）。ヒット群からAIがまとめた要約＋時系列＋要点と、
 * 根拠になったメール（クリックで原文へ）を表示。実際のソース一覧は下の行がそのまま。
 */
function SearchDigestPanel({
  digest,
  hitCount,
  onRun,
  onSelect,
  emailById,
}: {
  digest: "loading" | "error" | SearchDigest | null;
  hitCount: number;
  onRun: () => void;
  onSelect: (id: string) => void;
  emailById: Map<string, Email>;
}) {
  const { t } = useI18n();
  if (hitCount === 0) return null;

  if (digest === null) {
    return (
      <div className="mx-1 mb-2 rounded-xl border border-accent/30 bg-accent-soft/40 p-2.5">
        <button
          onClick={onRun}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-transform hover:scale-[1.01] active:scale-95"
        >
          <Sparkles className="size-4" />
          {t("aisearch.run")}
          <span className="text-xs opacity-80">
            {t("aisearch.count").replace("{n}", String(hitCount))}
          </span>
        </button>
      </div>
    );
  }

  if (digest === "loading") {
    return (
      <div className="mx-1 mb-2 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 p-3 text-sm text-accent">
        <Loader2 className="size-4 animate-spin" />
        {t("aisearch.loading")}
      </div>
    );
  }

  if (digest === "error") {
    return (
      <div className="mx-1 mb-2 flex items-center gap-2 rounded-xl border border-high/40 bg-high-soft p-3 text-sm text-high">
        <span className="flex-1">{t("aisearch.error")}</span>
        <button
          onClick={onRun}
          className="rounded-md border border-high/40 px-2 py-1 text-xs hover:bg-high/10"
        >
          {t("aisearch.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-1 mb-2 rounded-xl border border-accent/30 bg-surface p-3.5 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-accent" />
        <span className="text-xs font-semibold text-accent">
          {t("aisearch.heading")}
        </span>
        <button
          onClick={onRun}
          title={t("aisearch.regenerate")}
          className="ml-auto grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-accent"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
        {digest.summary}
      </p>

      {digest.timeline.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold text-fg-muted">
            {t("aisearch.timeline")}
          </div>
          <ul className="flex flex-col gap-1">
            {digest.timeline.map((tl, i) => (
              <li key={i} className="flex gap-2 text-xs">
                <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-medium tabular-nums text-fg-muted">
                  {tl.when}
                </span>
                <span className="text-fg-muted">{tl.what}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {digest.points.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold text-fg-muted">
            {t("aisearch.points")}
          </div>
          <ul className="flex flex-col gap-1">
            {digest.points.map((p, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-fg-muted">
                <span className="text-accent">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {digest.sources.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold text-fg-muted">
            {t("aisearch.sources")}
          </div>
          <div className="flex flex-col gap-1">
            {digest.sources.map((s, i) => {
              const e = emailById.get(s.id);
              return (
                <button
                  key={`${s.id}-${i}`}
                  onClick={() => onSelect(s.id)}
                  className="group flex items-start gap-2 rounded-lg border border-border px-2 py-1.5 text-left transition-colors hover:border-accent"
                >
                  <span
                    className="mt-0.5 grid size-5 shrink-0 place-items-center rounded text-[9px] font-semibold text-white"
                    style={{ background: avatarColor(e?.from.email ?? s.id) }}
                  >
                    {e ? initials(e.from) : "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-fg">
                      {e?.subject || "(メール)"}
                    </span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {s.reason}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * どのアカウント宛/発かを示す小さな色付きチップ（統合受信箱・送信箱で表示）。
 * ラベルは @ の前だけに短縮（morioka / g1989n）。色はアカウント色で識別。
 */
function AccountChip({ account, label }: { account: string; label: string }) {
  const short = label.split("@")[0] || label;
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-medium text-fg-muted"
      title={`アカウント: ${label}`}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: avatarColor(account) }}
      />
      <span className="max-w-[7rem] truncate">{short}</span>
    </span>
  );
}

/**
 * Compact action bar for per-message selection inside an expanded conversation.
 * Lets you archive/trash or mark importance on individual mails — e.g. handle
 * one inquiry of a same-subject group without touching the others.
 */
function SubActionBar({
  count,
  folder,
  onClear,
  onArchive,
  onTrash,
  onImportance,
}: {
  count: number;
  folder: FolderView;
  onClear: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onImportance: (importance: Importance) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1 rounded-lg border border-accent/30 bg-accent-soft/40 px-2 py-1">
      <button
        onClick={onClear}
        title={t("bulk.clear")}
        className="grid size-5 place-items-center rounded text-fg-subtle hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
      <span className="text-[11px] font-semibold tabular-nums">
        {count}
        {t("bulk.selectedSuffix")}
      </span>
      <span
        className="ml-1 flex items-center gap-0.5 rounded-md border border-border p-0.5"
        title={t("bulk.importance.hint")}
      >
        <button
          onClick={() => onImportance("high")}
          className="rounded px-1 py-0.5 text-[10px] font-medium text-high hover:bg-high-soft"
        >
          {t("importance.high")}
        </button>
        <button
          onClick={() => onImportance("normal")}
          className="rounded px-1 py-0.5 text-[10px] text-fg-muted hover:bg-surface-2"
        >
          {t("importance.normal")}
        </button>
        <button
          onClick={() => onImportance("low")}
          className="rounded px-1 py-0.5 text-[10px] text-fg-subtle hover:bg-surface-2"
        >
          {t("importance.low")}
        </button>
      </span>
      <span className="ml-auto flex items-center gap-0.5">
        {folder !== "archived" && folder !== "sent" && (
          <button
            onClick={onArchive}
            title={t("bulk.archive.title")}
            className="grid size-6 place-items-center rounded text-fg-muted hover:bg-accent-soft hover:text-accent"
          >
            <Archive className="size-3.5" />
          </button>
        )}
        {folder !== "trashed" && (
          <button
            onClick={onTrash}
            title={t("bulk.trash.title")}
            className="grid size-6 place-items-center rounded text-fg-muted hover:bg-high-soft hover:text-high"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * A single conversation member, shown inline when a thread row is expanded
 * (一覧側の全体像). Compact one-liner: 差出人／重要度／冒頭／添付／時刻。
 * Clicking opens that exact message; the avatar doubles as a checkbox so you can
 * select individual mails of the conversation for per-message actions.
 */
function ThreadMemberRow({
  email,
  active,
  terms,
  checked,
  selectionActive,
  onToggleCheck,
  onClick,
}: {
  email: Email;
  active: boolean;
  terms: string[];
  checked: boolean;
  selectionActive: boolean;
  onToggleCheck: () => void;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const sent = email.state === "sent";
  const name = sent ? t("thread.you") : email.from.name || email.from.email;
  const faceEmail = sent
    ? (email.to[0]?.email ?? email.from.email)
    : email.from.email;
  const showCheckbox = checked || selectionActive;
  return (
    <div
      onClick={onClick}
      title={email.subject}
      className={cn(
        "group/mem flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
        active
          ? "bg-accent-soft"
          : checked
            ? "bg-accent-soft/60"
            : "hover:bg-surface-2",
      )}
    >
      {/* Avatar ⇄ checkbox: hover or an active selection reveals the box. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleCheck();
        }}
        title={checked ? t("row.check.off") : t("row.check.on")}
        className="relative size-5 shrink-0"
      >
        <span
          className={cn(
            "grid size-5 place-items-center rounded-full text-[9px] font-semibold text-white transition-opacity",
            showCheckbox ? "opacity-0" : "group-hover/mem:opacity-0",
          )}
          style={{ background: avatarColor(faceEmail) }}
        >
          {sent ? t("thread.youInitial") : initials(email.from)}
        </span>
        <span
          className={cn(
            "absolute inset-0 grid place-items-center transition-opacity",
            showCheckbox
              ? "opacity-100"
              : "opacity-0 group-hover/mem:opacity-100",
          )}
        >
          <span
            className={cn(
              "grid size-4 place-items-center rounded border transition-colors",
              checked
                ? "border-accent bg-accent text-accent-fg"
                : "border-border bg-surface hover:border-accent",
            )}
          >
            {checked && <Check className="size-3" />}
          </span>
        </span>
      </button>
      <span
        className={cn(
          "w-24 shrink-0 truncate text-xs",
          email.read ? "text-fg-muted" : "font-semibold text-fg",
        )}
      >
        {name}
      </span>
      {email.importance === "high" && (
        <span className="shrink-0 rounded bg-high-soft px-1 text-[10px] font-semibold text-high">
          {t("importance.high")}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
        <Highlighted text={email.snippet || email.subject} terms={terms} />
      </span>
      {email.hasAttachment && (
        <Paperclip className="size-3 shrink-0 text-fg-subtle" />
      )}
      <span className="shrink-0 text-[10px] tabular-nums text-fg-subtle">
        {relativeTime(email.date)}
      </span>
    </div>
  );
}

function EmailListItem({
  row,
  active,
  folder,
  hasNote,
  hasDraft,
  checked,
  selectionActive,
  accountLabel,
  matchQuery,
  dense,
  expandable,
  expanded,
  onToggleExpand,
  onSelect,
  onToggleCheck,
  onArchive,
  onTrash,
  onToggleStar,
}: {
  row: ThreadRow;
  active: boolean;
  folder: FolderView;
  /** 1-line compact row (上下表示の上ペイン): sender · subject · time. */
  dense?: boolean;
  /** Active search text → show which field(s) each hit matched. Undefined when
   *  not searching. */
  matchQuery?: string;
  /** This email has a private note (自分用メモ) → show the 📝 badge. */
  hasNote: boolean;
  /** この会話に未送信の下書きがある（✏️インジケータ）。 */
  hasDraft?: boolean;
  /** This row is in the bulk selection. */
  checked: boolean;
  /** Any row is checked → checkboxes stay visible on every row. */
  selectionActive: boolean;
  /** This grouped row can unfold its conversation inline (count>1, non-search). */
  expandable?: boolean;
  /** Currently unfolded. */
  expanded?: boolean;
  /** Toggle inline expansion (count badge acts as the handle). */
  onToggleExpand?: () => void;
  /** Origin account badge text (unified inbox only); null hides it. */
  accountLabel: string | null;
  onSelect: () => void;
  /** shiftKey は Shift+クリックの連続選択判定に使う。 */
  onToggleCheck: (shiftKey: boolean) => void;
  onArchive: () => void;
  onTrash: () => void;
  onToggleStar: () => void;
}) {
  const { t } = useI18n();
  const { email, count, participants, unread, starred, threadTotal } = row;
  // Badge shows the TRUE conversation size (cache, cross-folder) = what inline
  // expansion reveals, so the number and the unfolded rows always agree.
  const convCount = threadTotal || count;
  const showBadge = expandable || count > 1;
  const hits = matchedFields(email, matchQuery);
  const terms = searchTerms(matchQuery);
  const threadActionHint =
    count > 1 ? t("row.threadAll").replace("{n}", String(count)) : "";
  // Sent mail: the avatar represents the recipient (the row shows "To: …").
  const face = email.state === "sent" && email.to[0] ? email.to[0] : email.from;
  const showCheckbox = checked || selectionActive;
  // Bring the selected row into view when it becomes active off-screen (e.g.
  // opening a thread message that lives in this folder / after a folder switch).
  // "nearest" = a no-op when the row is already visible (normal clicks).
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Bring the opened mail into view in both layouts (左右/上下). "nearest" is a
    // no-op when already visible (normal clicks); when off-screen — e.g. after
    // 「このメールを開く」や folder/layout 切替 — it scrolls it into view. A short
    // delay lets a just-switched layout (上下の短い一覧) settle before measuring.
    if (!active) return;
    const t = setTimeout(
      () =>
        rowRef.current?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        }),
      60,
    );
    return () => clearTimeout(t);
  }, [active]);

  // Dense 1-line row for the 上下表示 top pane: 差出人 · 件名 · アイコン · 時刻。
  // No avatar/preview so many more messages fit (件名が上にずらり)。
  if (dense) {
    return (
      <div
        ref={rowRef}
        onClick={onSelect}
        title={email.subject}
        className={cn(
          // Faint per-row rule (薄い罫線) for a scannable dense list.
          "group relative flex cursor-pointer items-center gap-2 border-b border-border/60 px-2.5 py-1.5 transition-colors",
          active
            ? "bg-accent-soft"
            : checked
              ? "bg-accent-soft/60"
              : "hover:bg-surface-2",
        )}
      >
        {/* Unread dot ⇄ checkbox: hover or an active selection reveals the box
            so 上下表示でもチェックして一括アーカイブ/削除できる。 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheck(e.shiftKey);
          }}
          title={checked ? t("row.check.off") : t("row.check.on")}
          className="relative flex size-4 shrink-0 items-center justify-center"
        >
          <span
            className={cn(
              "absolute size-1.5 rounded-full transition-opacity",
              unread ? "bg-accent" : "bg-transparent",
              showCheckbox ? "opacity-0" : "group-hover:opacity-0",
            )}
          />
          <span
            className={cn(
              "absolute grid size-3.5 place-items-center rounded border transition-opacity",
              checked
                ? "border-accent bg-accent text-accent-fg"
                : "border-border bg-surface",
              showCheckbox
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100",
            )}
          >
            {checked && <Check className="size-2.5" />}
          </span>
        </button>
        <span
          className={cn(
            "w-40 shrink-0 truncate text-xs",
            unread ? "font-semibold text-fg" : "text-fg-muted",
          )}
        >
          <Highlighted text={participants} terms={terms} />
        </span>
        {accountLabel && (
          <AccountChip account={email.account ?? ""} label={accountLabel} />
        )}
        {showBadge &&
          (expandable ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand?.();
              }}
              title={
                expanded ? t("list.thread.collapse") : t("list.thread.expand")
              }
              aria-expanded={expanded}
              className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface-2 px-1 text-[10px] font-semibold tabular-nums text-fg-muted transition-colors hover:text-accent"
            >
              <ChevronRight
                className={cn(
                  "size-3 transition-transform",
                  expanded && "rotate-90",
                )}
              />
              {convCount}
            </button>
          ) : (
            <span className="shrink-0 rounded-full bg-surface-2 px-1 text-[10px] font-semibold tabular-nums text-fg-muted">
              {convCount}
            </span>
          ))}
        {email.threat && (
          <span className="flex shrink-0 items-center gap-0.5 rounded bg-high px-1 text-[10px] font-semibold text-white">
            <ShieldAlert className="size-2.5" />
            {t(`threat.${email.threat}.badge`)}
          </span>
        )}
        {email.importance === "high" && !email.threat && (
          <span className="shrink-0 rounded bg-high-soft px-1 text-[10px] font-semibold text-high">
            {t("importance.high")}
          </span>
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            unread ? "font-medium text-fg" : "text-fg-muted",
          )}
        >
          <Highlighted text={email.subject} terms={terms} />
        </span>
        {/* Meta (time + status icons) — hidden on hover to reveal quick-actions. */}
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-fg-subtle group-hover:hidden">
          {starred && (
            <Star
              className="size-3 fill-amber-400 text-amber-400"
              aria-label={t("aria.starred")}
            />
          )}
          {email.replied && (
            <Reply
              className="size-3 text-accent"
              aria-label={t("aria.replied")}
            />
          )}
          {email.hasAttachment && (
            <Paperclip
              className="size-3 text-fg-muted"
              aria-label={t("aria.attachment")}
            />
          )}
          {hasNote && (
            <NotebookPen
              className="size-3 text-amber-500"
              aria-label={t("aria.note")}
            />
          )}
          {hasDraft && (
            <PenLine
              className="size-3 text-amber-600"
              aria-label={t("draft.badge")}
            />
          )}
          <span className="tabular-nums">{relativeTime(email.date)}</span>
        </span>
        {/* Right-edge quick-actions (same set as the classic row). */}
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar();
            }}
            title={email.starred ? t("row.star.off") : t("row.star.on")}
            className="grid size-6 place-items-center rounded-md text-fg-muted hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-400/10"
          >
            <Star
              className={cn(
                "size-3.5",
                email.starred && "fill-amber-400 text-amber-400",
              )}
            />
          </button>
          {folder !== "archived" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onArchive();
              }}
              title={`${t("row.archive.title")}${threadActionHint} (E)`}
              className="grid size-6 place-items-center rounded-md text-fg-muted hover:bg-accent-soft hover:text-accent"
            >
              <Archive className="size-3.5" />
            </button>
          )}
          {folder !== "trashed" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTrash();
              }}
              title={`${t("row.trash.title")}${threadActionHint}`}
              className="grid size-6 place-items-center rounded-md text-fg-muted hover:bg-high-soft hover:text-high"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      onClick={onSelect}
      className={cn(
        "group relative mb-0.5 cursor-pointer rounded-xl px-3 py-3 transition-colors",
        active
          ? "bg-accent-soft"
          : checked
            ? "bg-accent-soft/60"
            : "hover:bg-surface-2",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar ⇄ checkbox (Gmail-style): hover or active selection swaps. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheck(e.shiftKey);
          }}
          title={checked ? t("row.check.off") : t("row.check.on")}
          className="relative mt-0.5 size-9 shrink-0"
        >
          <span
            className={cn(
              "grid size-9 place-items-center rounded-full text-xs font-semibold text-white transition-opacity",
              showCheckbox ? "opacity-0" : "group-hover:opacity-0",
            )}
            style={{ background: avatarColor(face.email) }}
          >
            {initials(face)}
          </span>
          <span
            className={cn(
              "absolute inset-0 grid place-items-center transition-opacity",
              showCheckbox
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100",
            )}
          >
            <span
              className={cn(
                "grid size-5 place-items-center rounded-md border transition-colors",
                checked
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border bg-surface hover:border-accent",
              )}
            >
              {checked && <Check className="size-3.5" />}
            </span>
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {unread && (
              <span className="size-2 shrink-0 rounded-full bg-accent" />
            )}
            <span
              className={cn(
                "truncate text-sm",
                unread ? "font-semibold text-fg" : "font-normal text-fg-muted",
              )}
            >
              <Highlighted text={participants} terms={terms} />
            </span>
            {showBadge &&
              (expandable ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand?.();
                  }}
                  title={
                    expanded
                      ? t("list.thread.collapse")
                      : t("list.thread.expand")
                  }
                  aria-expanded={expanded}
                  className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold tabular-nums text-fg-muted transition-colors hover:text-accent"
                >
                  <ChevronRight
                    className={cn(
                      "size-3 transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                  {convCount}
                </button>
              ) : (
                <span
                  title={t("list.threadCount.title").replace(
                    "{n}",
                    String(convCount),
                  )}
                  className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold tabular-nums text-fg-muted"
                >
                  {convCount}
                </span>
              ))}
            {accountLabel && (
              <AccountChip account={email.account ?? ""} label={accountLabel} />
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-fg-subtle">
              {starred && (
                <Star
                  className="size-3 fill-amber-400 text-amber-400"
                  aria-label={t("aria.starred")}
                />
              )}
              {email.replied && (
                <Reply
                  className="size-3 text-accent"
                  aria-label={t("aria.replied")}
                />
              )}
              {email.hasAttachment && (
                <Paperclip
                  className="size-3 text-fg-muted"
                  aria-label={t("aria.attachment")}
                />
              )}
              {hasNote && (
                <NotebookPen
                  className="size-3 text-amber-500"
                  aria-label={t("aria.note")}
                />
              )}
              {hasDraft && (
                <PenLine
                  className="size-3 text-amber-600"
                  aria-label={t("draft.badge")}
                />
              )}
              {relativeTime(email.date)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {email.threat && (
              <span
                title={t(`threat.${email.threat}.title`)}
                className="flex shrink-0 items-center gap-0.5 rounded bg-high px-1 text-[10px] font-semibold text-white"
              >
                <ShieldAlert className="size-2.5" />
                {t(`threat.${email.threat}.badge`)}
              </span>
            )}
            {email.importance === "high" && !email.threat && (
              <span
                title={t("importance.high.title")}
                className="shrink-0 rounded bg-high-soft px-1 text-[10px] font-semibold text-high"
              >
                {t("importance.high")}
              </span>
            )}
            {email.importance === "low" && !email.threat && (
              <span
                title={t("importance.low.title")}
                className="shrink-0 rounded bg-surface-2 px-1 text-[10px] text-fg-subtle"
              >
                {t("importance.low")}
              </span>
            )}
            <p
              className={cn(
                "truncate text-sm",
                unread ? "font-medium text-fg" : "text-fg-muted",
              )}
            >
              <Highlighted text={email.subject} terms={terms} />
            </p>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            {/* 検索時: どこに一致したかを明示（件名/本文/差出人/宛先）。 */}
            {hits.length > 0 && (
              <span
                className="flex shrink-0 items-center gap-1"
                title={`${t("match.label")}: ${hits.map((h) => t(`match.${h}`)).join(" / ")}`}
              >
                {hits.map((h) => (
                  <span
                    key={h}
                    className="rounded bg-accent-soft px-1 py-px text-[10px] font-medium text-accent"
                  >
                    {t(`match.${h}`)}
                  </span>
                ))}
              </span>
            )}
            <p className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
              <Highlighted text={previewFor(email, terms)} terms={terms} />
            </p>
          </div>
        </div>
      </div>

      {/* Hover quick-actions */}
      <div className="absolute right-2 top-2 hidden items-center gap-1 rounded-lg bg-surface/90 p-0.5 shadow-sm backdrop-blur group-hover:flex">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar();
          }}
          title={email.starred ? t("row.star.off") : t("row.star.on")}
          className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-400/10"
        >
          <Star
            className={cn(
              "size-4",
              email.starred && "fill-amber-400 text-amber-400",
            )}
          />
        </button>
        {folder !== "archived" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            title={`${t("row.archive.title")}${threadActionHint} (E)`}
            className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-accent-soft hover:text-accent"
          >
            <Archive className="size-4" />
          </button>
        )}
        {folder !== "trashed" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTrash();
            }}
            title={`${t("row.trash.title")}${threadActionHint}`}
            className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-high-soft hover:text-high"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
