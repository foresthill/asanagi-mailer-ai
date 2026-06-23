"use client";

import { useState } from "react";
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
  RefreshCw,
  Reply,
  Search,
  Star,
  X,
} from "lucide-react";
import type { FolderView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { avatarColor, initials, relativeTime } from "./helpers";
import type { ThreadRow } from "./threadList";

const FOLDER_LABEL: Record<FolderView, string> = {
  inbox: "受信箱",
  starred: "スター付き",
  sent: "送信箱",
  archived: "アーカイブ",
  trashed: "ゴミ箱",
};

/** 一覧のグループ化軸（折りたたみセクション）。 */
export type GroupAxis = "none" | "account" | "sender";

const AXIS_LABEL: Record<GroupAxis, string> = {
  none: "なし",
  account: "アカウント",
  sender: "送信者",
};

/** メールアドレスのドメイン部（送信者グループのキー）。 */
function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : email.toLowerCase();
}

/** rows を選択軸でセクションに束ねる。各セクションは元の日付順を保つ。 */
function buildSections(
  rows: ThreadRow[],
  axis: GroupAxis,
  accountLabels: Record<string, string> | null,
): { key: string; label: string; rows: ThreadRow[] }[] {
  if (axis === "none") return [{ key: "_all", label: "", rows }];
  const map = new Map<string, { key: string; label: string; rows: ThreadRow[] }>();
  for (const r of rows) {
    let key: string;
    let label: string;
    if (axis === "account") {
      key = r.email.account ?? "";
      label = (accountLabels && accountLabels[key]) || key || "(不明)";
    } else {
      key = domainOf(r.email.from.email);
      label = key || "(不明)";
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
  selectedId,
  searchQuery,
  searching,
  grouping,
  groupAxis,
  noteIds,
  onChangeGroupAxis,
  serverSearched,
  serverSearching,
  accountLabels,
  checkedIds,
  onToggleCheck,
  onCheckAll,
  onClearChecked,
  onBulkArchive,
  onBulkTrash,
  onSearchChange,
  onServerSearch,
  onToggleGrouping,
  onSelect,
  onArchive,
  onTrash,
  onToggleStar,
  onRefresh,
}: {
  folder: FolderView;
  /** Conversation rows (1 row = 1 conversation when grouping is on). */
  rows: ThreadRow[];
  loading: boolean;
  selectedId: string | null;
  /** Current search box value; non-empty switches the list to results. */
  searchQuery: string;
  /** True while the list shows search results instead of the folder. */
  searching: boolean;
  /** スレッド表示（1会話=1行）が有効か。検索結果では常に個別表示。 */
  grouping: boolean;
  /** セクション分けの軸（なし/アカウント別/送信者ドメイン別）。 */
  groupAxis: GroupAxis;
  /** 自分用メモがあるメールIDの集合（📝インジケータ用）。 */
  noteIds: Set<string>;
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
  onCheckAll: () => void;
  onClearChecked: () => void;
  onBulkArchive: () => void;
  onBulkTrash: () => void;
  onSearchChange: (q: string) => void;
  onServerSearch: () => void;
  onToggleGrouping: () => void;
  onSelect: (id: string) => void;
  /** Thread-unit: every id of the row (1 element when not grouped). */
  onArchive: (ids: string[]) => void;
  onTrash: (ids: string[]) => void;
  onToggleStar: (id: string) => void;
  onRefresh: () => void;
}) {
  const selectionActive = checkedIds.size > 0;
  // 折りたたんだセクションのキー（軸ごとに保持）。
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 検索結果は横断のため軸グループ化しない（特定の1通を探す行為）。
  const effectiveAxis: GroupAxis = searching ? "none" : groupAxis;
  const sections = buildSections(rows, effectiveAxis, accountLabels);
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderRow = (row: ThreadRow) => (
    <EmailListItem
      key={row.email.id}
      row={row}
      active={row.email.id === selectedId}
      folder={folder}
      hasNote={noteIds.has(row.email.id)}
      checked={checkedIds.has(row.email.id)}
      selectionActive={selectionActive}
      accountLabel={
        accountLabels && row.email.account
          ? (accountLabels[row.email.account] ?? row.email.account)
          : null
      }
      onSelect={() => onSelect(row.email.id)}
      onToggleCheck={() => onToggleCheck(row.email.id)}
      onArchive={() => onArchive(row.ids)}
      onTrash={() => onTrash(row.ids)}
      onToggleStar={() => onToggleStar(row.email.id)}
    />
  );

  return (
    <div className="flex w-[384px] shrink-0 flex-col border-r border-border bg-surface">
      {selectionActive ? (
        // Bulk action bar — replaces the header while rows are checked.
        <header className="flex items-center gap-1.5 px-4 pb-2 pt-5">
          <button
            onClick={onClearChecked}
            title="選択を解除"
            className="grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
          <span className="text-sm font-semibold tabular-nums">{checkedIds.size}件選択中</span>
          <button
            onClick={onCheckAll}
            className="rounded-md px-1.5 py-0.5 text-xs text-accent hover:bg-accent-soft"
          >
            全選択
          </button>
          <span className="ml-auto flex items-center gap-1">
            {folder !== "archived" && folder !== "sent" && (
              <button
                onClick={onBulkArchive}
                title="選択した会話をすべてアーカイブ"
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent"
              >
                <Archive className="size-3.5" />
                アーカイブ
              </button>
            )}
            {folder !== "trashed" && (
              <button
                onClick={onBulkTrash}
                title="選択した会話をすべてゴミ箱へ"
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-high hover:text-high"
              >
                <Trash2 className="size-3.5" />
                ゴミ箱
              </button>
            )}
          </span>
        </header>
      ) : (
        <header className="flex items-center gap-2 px-5 pb-2 pt-5">
          <h1 className="text-base font-semibold tracking-tight">
            {searching ? "検索結果" : FOLDER_LABEL[folder]}
          </h1>
          {!searching && (
            <>
              <button
                onClick={onRefresh}
                disabled={loading}
                title="更新"
                className="grid size-6 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </button>
              <button
                onClick={onToggleGrouping}
                title={
                  grouping
                    ? "スレッド表示中（1会話=1行）— クリックで個別表示"
                    : "個別表示中 — クリックでスレッド表示（1会話=1行）"
                }
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
                  title="一括選択（すべて選択）— 残すものだけ外して、まとめてアーカイブ/ゴミ箱へ"
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-fg-subtle transition-colors hover:bg-surface-2 hover:text-accent"
                >
                  <span className="grid size-3.5 place-items-center rounded-[3px] border border-current" />
                  選択
                </button>
              )}
            </>
          )}
          <span className="ml-auto text-xs text-fg-subtle">{rows.length}件</span>
        </header>
      )}

      {/* Search across the local cache (all accounts & folders). */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 focus-within:border-accent">
          <Search className="size-3.5 shrink-0 text-fg-subtle" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="検索（件名・本文・差出人）"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              title="検索をクリア"
              className="grid size-5 shrink-0 place-items-center rounded text-fg-subtle hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* グループ化軸: なし / アカウント別 / 送信者ドメイン別（折りたたみ表示）。 */}
      {!searching && (
        <div className="flex items-center gap-1.5 px-4 pb-2 text-[11px] text-fg-subtle">
          <span>グループ:</span>
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
              {AXIS_LABEL[a]}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="grid h-40 place-items-center text-fg-subtle">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="grid h-60 place-items-center px-6 text-center">
            <div className="flex flex-col items-center gap-2 text-fg-subtle">
              <Inbox className="size-8 opacity-50" />
              <p className="text-sm">
                {searching
                  ? serverSearched
                    ? "サーバ全履歴にも該当するメールがありません"
                    : "該当するメールがありません（ローカルキャッシュ内を検索）"
                  : folder === "inbox"
                    ? "受信箱はすべて片付きました 🎉"
                    : "ここには何もありません"}
              </p>
              {searching && !serverSearched && (
                <ServerSearchButton searching={serverSearching} onClick={onServerSearch} />
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
                  <span className="shrink-0 tabular-nums text-fg-subtle">{sec.rows.length}</span>
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
              <span className="text-[11px] text-fg-subtle">サーバ全履歴を含む結果です</span>
            ) : (
              <ServerSearchButton searching={serverSearching} onClick={onServerSearch} />
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
  return (
    <button
      onClick={onClick}
      disabled={searching}
      title="キャッシュ外の過去メールも検索します（Gmailの検索演算子も使えます）"
      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
    >
      {searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
      {searching ? "サーバ全履歴を検索中…" : "サーバ全履歴を検索"}
    </button>
  );
}

function EmailListItem({
  row,
  active,
  folder,
  hasNote,
  checked,
  selectionActive,
  accountLabel,
  onSelect,
  onToggleCheck,
  onArchive,
  onTrash,
  onToggleStar,
}: {
  row: ThreadRow;
  active: boolean;
  folder: FolderView;
  /** This email has a private note (自分用メモ) → show the 📝 badge. */
  hasNote: boolean;
  /** This row is in the bulk selection. */
  checked: boolean;
  /** Any row is checked → checkboxes stay visible on every row. */
  selectionActive: boolean;
  /** Origin account badge text (unified inbox only); null hides it. */
  accountLabel: string | null;
  onSelect: () => void;
  onToggleCheck: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onToggleStar: () => void;
}) {
  const { email, count, participants, unread, starred } = row;
  const threadActionHint = count > 1 ? `（会話${count}通すべて）` : "";
  // Sent mail: the avatar represents the recipient (the row shows "To: …").
  const face = email.state === "sent" && email.to[0] ? email.to[0] : email.from;
  const showCheckbox = checked || selectionActive;
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative mb-0.5 cursor-pointer rounded-xl px-3 py-3 transition-colors",
        active ? "bg-accent-soft" : checked ? "bg-accent-soft/60" : "hover:bg-surface-2",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar ⇄ checkbox (Gmail-style): hover or active selection swaps. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheck();
          }}
          title={checked ? "選択を外す (X)" : "選択する (X)"}
          className="relative mt-0.5 size-9 shrink-0"
        >
          <span
            className={cn(
              "grid size-9 place-items-center rounded-full text-xs font-semibold text-white transition-opacity",
              showCheckbox ? "opacity-0" : "group-hover:opacity-0",
            )}
            style={{ background: avatarColor(participants) }}
          >
            {initials(face)}
          </span>
          <span
            className={cn(
              "absolute inset-0 grid place-items-center transition-opacity",
              showCheckbox ? "opacity-100" : "opacity-0 group-hover:opacity-100",
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
            {unread && <span className="size-2 shrink-0 rounded-full bg-accent" />}
            <span
              className={cn(
                "truncate text-sm",
                unread ? "font-semibold text-fg" : "font-normal text-fg-muted",
              )}
            >
              {participants}
            </span>
            {count > 1 && (
              <span
                title={`この会話のメール ${count}通を1行に集約しています`}
                className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold tabular-nums text-fg-muted"
              >
                {count}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-fg-subtle">
              {starred && (
                <Star className="size-3 fill-amber-400 text-amber-400" aria-label="スター付き" />
              )}
              {email.replied && (
                <Reply className="size-3 text-accent" aria-label="返信済み" />
              )}
              {email.hasAttachment && (
                <Paperclip className="size-3 text-fg-muted" aria-label="添付ファイルあり" />
              )}
              {hasNote && (
                <NotebookPen className="size-3 text-amber-500" aria-label="自分用メモあり" />
              )}
              {relativeTime(email.date)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {email.importance === "high" && (
              <span
                title="簡易判定: 重要（学習シグナル/キーワード。開くとAIが精密判定）"
                className="shrink-0 rounded bg-high-soft px-1 text-[10px] font-semibold text-high"
              >
                重要
              </span>
            )}
            {email.importance === "low" && (
              <span
                title="簡易判定: 低（ニュースレター等。開くとAIが精密判定）"
                className="shrink-0 rounded bg-surface-2 px-1 text-[10px] text-fg-subtle"
              >
                低
              </span>
            )}
            <p
              className={cn(
                "truncate text-sm",
                unread ? "font-medium text-fg" : "text-fg-muted",
              )}
            >
              {email.subject}
            </p>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-fg-subtle">{email.snippet}</p>
            {accountLabel && (
              <span
                className="flex max-w-[40%] shrink-0 items-center gap-1 rounded-full border border-border bg-surface-2 px-1.5 py-px text-[10px] text-fg-muted"
                title={`アカウント: ${accountLabel}`}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: avatarColor(email.account ?? "") }}
                />
                <span className="truncate">{accountLabel}</span>
              </span>
            )}
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
          title={email.starred ? "スターを外す (S)" : "スターを付ける (S)"}
          className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-400/10"
        >
          <Star className={cn("size-4", email.starred && "fill-amber-400 text-amber-400")} />
        </button>
        {folder !== "archived" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            title={`アーカイブ${threadActionHint} (E)`}
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
            title={`ゴミ箱へ${threadActionHint}`}
            className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-high-soft hover:text-high"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
