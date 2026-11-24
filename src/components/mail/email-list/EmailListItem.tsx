"use client";

import { useEffect, useRef } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  NotebookPen,
  Paperclip,
  PenLine,
  Reply,
  ShieldAlert,
  Square,
  SquareCheck,
  Star,
  Trash2,
} from "lucide-react";
import type {
  Email,
  FolderView,
  ContactColor,
  ContactLabel,
  MailboxState,
} from "@/lib/types";
import { contactColorHex } from "@/lib/contact-colors";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { avatarColor, initials, relativeTime } from "../helpers";
import type { ThreadRow } from "../threadList";
import {
  Highlighted,
  previewFor,
  matchedFields,
  searchTerms,
  type ColumnPrefs,
  type MetaColumnKey,
} from "./shared";

// 一覧の 1 行（EmailList から切り出し・見た目と挙動は不変）。行内で使う小さな
// バッジ（AccountChip / LabelBadge / StateChip）もこの行専用なので同居させる。

function AccountChip({ account, label }: { account: string; label: string }) {
  const { t } = useI18n();
  const short = label.split("@")[0] || label;
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-medium text-fg-muted"
      title={t("sweep.account").replace("{label}", label)}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: avatarColor(account) }}
      />
      <span className="max-w-[7rem] truncate">{short}</span>
    </span>
  );
}

function LabelBadge({ label }: { label?: ContactLabel }) {
  const { t } = useI18n();
  if (label !== "vip" && label !== "spam") return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 text-[9px] font-semibold leading-tight",
        label === "vip"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
          : "bg-high-soft text-high",
      )}
      title={t(`contact.meta.${label}`)}
    >
      {t(`contact.badge.${label}`)}
    </span>
  );
}

/** 現在地バッジ（受信箱/アーカイブ/ゴミ箱/送信箱）。検索などフォルダ横断の
 *  一覧で、そのメールが今どこにあるかを示す。 */
function StateChip({ state }: { state: MailboxState }) {
  const { t } = useI18n();
  const cls: Record<MailboxState, string> = {
    inbox: "bg-accent-soft text-accent",
    archived: "bg-surface-2 text-fg-muted",
    trashed: "bg-high-soft text-high",
    junk: "bg-high-soft text-high",
    sent: "bg-surface-2 text-fg-muted",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 text-[10px] font-semibold",
        cls[state],
      )}
    >
      {t(`folder.${state}`)}
    </span>
  );
}

export function EmailListItem({
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
  onRestore,
  onTrash,
  onToggleStar,
  isTodo,
  onToggleTodo,
  contactLabel,
  contactColor,
  ruleColor,
  columns,
  metaOrder,
  showLocation,
}: {
  row: ThreadRow;
  active: boolean;
  folder: FolderView;
  /** 検索結果などフォルダ横断の一覧で、各行に現在地（受信箱/アーカイブ/ゴミ箱/
   *  送信箱）バッジを出す。通常のフォルダ表示では不要（場所は自明）。 */
  showLocation?: boolean;
  /** Resolve the correspondent's label (重要取引先/迷惑) for the badge. */
  contactLabel?: (email?: string) => ContactLabel | undefined;
  contactColor?: (email?: string) => ContactColor | undefined;
  ruleColor?: (e: Email) => ContactColor | undefined;
  /** 表示する列（送信者/プレビュー/フラグ/添付/日時）。件名は常時表示。 */
  columns: ColumnPrefs;
  /** 右端「指標の固定列」(flag/attachment/date) の並び順。上下表示で使用。 */
  metaOrder: MetaColumnKey[];
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
  /** 受信箱に戻す（アーカイブ/ゴミ箱フォルダの行で表示）。 */
  onRestore: () => void;
  onTrash: () => void;
  onToggleStar: () => void;
  /** このメールが TODO 登録済みか。 */
  isTodo?: boolean;
  /** TODO 追加/解除（連携が有効なときだけ渡る）。 */
  onToggleTodo?: () => void;
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
  const label = contactLabel?.(face.email);
  // 行の左の細いアクセントバー。仕分けルール（件名/宛先/添付も見る・上から先勝ち）
  // を優先し、当たらなければ差出人の連絡先色（最小 Rules）へフォールバック。
  const accentHex = contactColorHex(
    ruleColor?.(email) ?? contactColor?.(face.email),
  );
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
        {accentHex && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[3px] rounded-r"
            style={{ backgroundColor: accentHex }}
          />
        )}
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
        {columns.from && (
          <span
            className={cn(
              "w-40 shrink-0 truncate text-xs",
              unread ? "font-semibold text-fg" : "text-fg-muted",
            )}
          >
            <Highlighted text={participants} terms={terms} />
          </span>
        )}
        <LabelBadge label={label} />
        {accountLabel && (
          <AccountChip account={email.account ?? ""} label={accountLabel} />
        )}
        {showLocation && <StateChip state={email.state} />}
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
        {/* Preview column (wide pane only — dense is compact by nature). */}
        {columns.preview && (
          <span className="hidden min-w-0 flex-1 truncate text-xs text-fg-subtle lg:block">
            <Highlighted text={previewFor(email, terms)} terms={terms} />
          </span>
        )}
        {/* Meta — variable glyphs (返信済/メモ/下書き), then the fixed indicator
            columns (フラグ/添付/日時) in the user's chosen order. Each fixed column
            reserves its width so ★ · 📎 · 日時 line up down the list even when a row
            has none of them (#2 scannability). Hidden on hover to reveal actions. */}
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-fg-subtle">
          {/* 変動グリフ（返信済/メモ/下書き）は hover でアクションに場所を譲る。 */}
          <span className="flex items-center gap-1 group-hover:hidden">
            {email.replied && (
              <Reply
                className="size-3 text-accent"
                aria-label={t("aria.replied")}
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
          </span>
          {metaOrder.map((k) =>
            !columns[k] ? null : k === "flag" ? (
              // ★フラグ列はクリックでその場スター切替。常時表示（hover でも隠さない）
              // ＝カーソルを乗せても消えず押せる。未スターは hover で薄く出して誘導。
              <button
                key={k}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar();
                }}
                title={email.starred ? t("row.star.off") : t("row.star.on")}
                className="grid w-5 shrink-0 place-items-center rounded text-fg-subtle hover:text-amber-500"
              >
                <Star
                  className={cn(
                    "size-3",
                    starred
                      ? "fill-amber-400 text-amber-400"
                      : "opacity-0 group-hover:opacity-50",
                  )}
                  aria-label={
                    email.starred ? t("row.star.off") : t("row.star.on")
                  }
                />
              </button>
            ) : k === "attachment" ? (
              <span
                key={k}
                className="grid w-4 shrink-0 place-items-center group-hover:hidden"
              >
                {email.hasAttachment && (
                  <Paperclip
                    className="size-3 text-fg-muted"
                    aria-label={t("aria.attachment")}
                  />
                )}
              </span>
            ) : (
              <span
                key={k}
                className="w-14 shrink-0 text-right tabular-nums group-hover:hidden"
              >
                {relativeTime(email.date)}
              </span>
            ),
          )}
        </span>
        {/* Right-edge quick-actions. スター切替は★フラグ列に移したので、ここでは
            フラグ列を非表示にしている場合のフォールバックとしてのみ★を出す。 */}
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {!columns.flag && (
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
          )}
          {onToggleTodo && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleTodo();
              }}
              title={isTodo ? t("todo.remove") : t("todo.add")}
              className={cn(
                "grid size-6 place-items-center rounded-md hover:bg-accent-soft hover:text-accent",
                isTodo ? "text-accent" : "text-fg-muted",
              )}
            >
              {isTodo ? (
                <SquareCheck className="size-3.5" />
              ) : (
                <Square className="size-3.5" />
              )}
            </button>
          )}
          {(folder === "archived" || folder === "trashed") && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRestore();
              }}
              title={`${t("reader.restore")}${threadActionHint}`}
              className="grid size-6 place-items-center rounded-md text-fg-muted hover:bg-accent-soft hover:text-accent"
            >
              <ArchiveRestore className="size-3.5" />
            </button>
          )}
          {folder !== "archived" && email.state !== "archived" && (
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
          {folder !== "trashed" && email.state !== "trashed" && (
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
      {accentHex && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-[3px] rounded-r"
          style={{ backgroundColor: accentHex }}
        />
      )}
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
            {columns.from && (
              <span
                className={cn(
                  "truncate text-sm",
                  unread
                    ? "font-semibold text-fg"
                    : "font-normal text-fg-muted",
                )}
              >
                <Highlighted text={participants} terms={terms} />
              </span>
            )}
            <LabelBadge label={label} />
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
            {/* 右端メタ: 状態グリフ → 整列した「添付」「日時」列（固定幅で 📎 と
                日時が行をまたいで縦に揃う）。 */}
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
              {columns.attachment && (
                <span className="grid w-4 shrink-0 place-items-center">
                  {email.hasAttachment && (
                    <Paperclip
                      className="size-3 text-fg-muted"
                      aria-label={t("aria.attachment")}
                    />
                  )}
                </span>
              )}
              {columns.date && (
                <span className="w-14 shrink-0 text-right tabular-nums">
                  {relativeTime(email.date)}
                </span>
              )}
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
            {columns.preview && (
              <p className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
                <Highlighted text={previewFor(email, terms)} terms={terms} />
              </p>
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
        {onToggleTodo && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleTodo();
            }}
            title={isTodo ? t("todo.remove") : t("todo.add")}
            className={cn(
              "grid size-7 place-items-center rounded-md hover:bg-accent-soft hover:text-accent",
              isTodo ? "text-accent" : "text-fg-muted",
            )}
          >
            {isTodo ? (
              <SquareCheck className="size-4" />
            ) : (
              <Square className="size-4" />
            )}
          </button>
        )}
        {(folder === "archived" || folder === "trashed") && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRestore();
            }}
            title={`${t("reader.restore")}${threadActionHint}`}
            className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-accent-soft hover:text-accent"
          >
            <ArchiveRestore className="size-4" />
          </button>
        )}
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
