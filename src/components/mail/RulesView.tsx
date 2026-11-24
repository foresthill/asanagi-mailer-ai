"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  ListFilter,
  Star,
  ListTodo,
  Archive,
  Ban,
  Zap,
  Undo2,
} from "lucide-react";
import type {
  ContactColor,
  MailRule,
  RuleAction,
  RuleCondition,
  RuleField,
  RuleOp,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { CONTACT_COLORS, contactColorHex } from "@/lib/contact-colors";
import { useI18n } from "@/lib/i18n";

/** Draft to prefill the editor from an open email (「このメールからルールを作成」). */
export interface RuleDraft {
  name?: string;
  conditions?: RuleCondition[];
}

/** 移動先アクション（相互排他）。 */
type MoveAction = "none" | "archive" | "junk";

type EditState = {
  id?: string;
  name: string;
  match: "all" | "any";
  conditions: RuleCondition[];
  /** "none" = 色を付けない。 */
  color: ContactColor | "none";
  star: boolean;
  todo: boolean;
  move: MoveAction;
};

/** 適用結果の取り消し用ペイロード（サーバの PerAccountUndo と対応）。 */
type UndoPayload = {
  account: string;
  starred: string[];
  archived: string[];
  junked: string[];
  todos: string[];
};

function blankCondition(): RuleCondition {
  return { field: "from", op: "contains", value: "" };
}

function draftToEdit(d?: RuleDraft): EditState {
  return {
    name: d?.name ?? "",
    match: "all",
    conditions:
      d?.conditions && d.conditions.length ? d.conditions : [blankCondition()],
    color: "orange",
    star: false,
    todo: false,
    move: "none",
  };
}

/** ルールの actions 配列 → 編集状態のアクション部分。 */
function actionsToEdit(actions: RuleAction[]): Pick<
  EditState,
  "color" | "star" | "todo" | "move"
> {
  return {
    color: actions.find((a) => a.type === "color")?.color ?? "none",
    star: actions.some((a) => a.type === "star"),
    todo: actions.some((a) => a.type === "todo"),
    move: actions.some((a) => a.type === "junk")
      ? "junk"
      : actions.some((a) => a.type === "archive")
        ? "archive"
        : "none",
  };
}

/** 編集状態 → 保存する actions 配列。 */
function editToActions(e: EditState): RuleAction[] {
  const out: RuleAction[] = [];
  if (e.color !== "none") out.push({ type: "color", color: e.color });
  if (e.star) out.push({ type: "star" });
  if (e.todo) out.push({ type: "todo" });
  if (e.move !== "none") out.push({ type: e.move });
  return out;
}

/**
 * Mail rules manager (Mac Mail-style Rules). v1 action = color a list row.
 * Rules are evaluated top-down (first match wins) and reflect live on save —
 * no mail is moved or modified (color is a local display attribute). local-first.
 */
export function RulesView({
  initialDraft,
  onDraftConsumed,
}: {
  /** When set, open the editor prefilled (from an email). */
  initialDraft?: RuleDraft | null;
  onDraftConsumed?: () => void;
}) {
  const { t } = useI18n();
  const [rules, setRules] = useState<MailRule[] | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 「今すぐ適用」: 実行中フラグ・結果メッセージ・取り消し用ペイロード。
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [undoPayload, setUndoPayload] = useState<UndoPayload[] | null>(null);
  const [undoing, setUndoing] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/rules");
      const data = await res.json();
      setRules((data.rules ?? []) as MailRule[]);
    } catch {
      setRules([]);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch
    load();
  }, []);

  // Open the editor prefilled when an email handed us a draft (respond to a
  // parent prop change — setState here is intended, not a cascading render).
  useEffect(() => {
    if (!initialDraft) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill on prop change
    setEdit(draftToEdit(initialDraft));
    onDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft]);

  const startAdd = () => {
    setError(null);
    setEdit(draftToEdit());
  };

  const startEdit = (r: MailRule) => {
    setError(null);
    setEdit({
      id: r.id,
      name: r.name,
      match: r.match,
      conditions: r.conditions.length ? r.conditions : [blankCondition()],
      ...actionsToEdit(r.actions),
    });
  };

  const save = async () => {
    if (!edit) return;
    const actions = editToActions(edit);
    if (actions.length === 0) {
      setError(t("rules.action.required"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: edit.id,
          name: edit.name,
          match: edit.match,
          conditions: edit.conditions,
          actions,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "保存に失敗しました");
        return;
      }
      setRules((data.rules ?? []) as MailRule[]);
      setEdit(null);
    } catch {
      setError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/rules?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      setRules((data.rules ?? []) as MailRule[]);
    } catch {
      /* non-critical */
    }
  };

  const reorder = async (index: number, dir: -1 | 1) => {
    if (!rules) return;
    const next = rules.slice();
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setRules(next); // optimistic
    try {
      const res = await fetch("/api/rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: next.map((r) => r.id) }),
      });
      const data = await res.json();
      if (data.rules) setRules(data.rules as MailRule[]);
    } catch {
      load(); // resync on failure
    }
  };

  const toggleEnabled = async (r: MailRule) => {
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...r, enabled: !r.enabled }),
      });
      const data = await res.json();
      if (data.rules) setRules(data.rules as MailRule[]);
    } catch {
      /* non-critical */
    }
  };

  // 有効な全ルールのアクションを現在の受信箱へ一括適用（移動系含む）＋取り消し。
  const applyNow = async () => {
    setApplying(true);
    setApplyMsg(null);
    setUndoPayload(null);
    try {
      const res = await fetch("/api/rules/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        empty?: boolean;
        counts?: {
          starred: number;
          archived: number;
          junked: number;
          todos: number;
        };
        undo?: UndoPayload[];
      };
      if (data.empty) {
        setApplyMsg(t("rules.apply.noRules"));
        return;
      }
      const c = data.counts;
      const total = c
        ? c.starred + c.archived + c.junked + c.todos
        : 0;
      if (total === 0) {
        setApplyMsg(t("rules.apply.noMatch"));
        return;
      }
      setApplyMsg(
        t("rules.apply.done")
          .replace("{star}", String(c?.starred ?? 0))
          .replace("{archive}", String(c?.archived ?? 0))
          .replace("{junk}", String(c?.junked ?? 0))
          .replace("{todo}", String(c?.todos ?? 0)),
      );
      if (data.undo && data.undo.length) setUndoPayload(data.undo);
    } catch {
      setApplyMsg(t("rules.apply.fail"));
    } finally {
      setApplying(false);
    }
  };

  const undoApply = async () => {
    if (!undoPayload) return;
    setUndoing(true);
    try {
      await fetch("/api/rules/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ undo: undoPayload }),
      });
      setUndoPayload(null);
      setApplyMsg(t("rules.apply.undone"));
    } catch {
      setApplyMsg(t("rules.apply.fail"));
    } finally {
      setUndoing(false);
    }
  };

  const fieldLabel = (f: RuleField) => t(`rules.field.${f}`);
  const opLabel = (o?: RuleOp) => t(`rules.op.${o ?? "contains"}`);

  const condSummary = (c: RuleCondition): string => {
    if (c.field === "hasAttachment") {
      return `${fieldLabel(c.field)}: ${c.value === "no" ? t("rules.att.no") : t("rules.att.yes")}`;
    }
    return `${fieldLabel(c.field)} ${opLabel(c.op)} "${c.value ?? ""}"`;
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <header className="mb-3 flex items-center gap-2">
        <ListFilter className="size-5 text-accent" />
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">{t("rules.title")}</h1>
          <p className="text-xs text-fg-subtle">{t("rules.subtitle")}</p>
        </div>
        <button
          onClick={applyNow}
          disabled={applying || !rules || rules.length === 0}
          title={t("rules.apply.hint")}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm text-fg-muted hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {applying ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Zap className="size-4" />
          )}
          {t("rules.apply")}
        </button>
        <button
          onClick={startAdd}
          className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          <Plus className="size-4" />
          {t("rules.add")}
        </button>
      </header>

      {applyMsg && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg-muted">
          <span className="break-all">{applyMsg}</span>
          {undoPayload && (
            <button
              onClick={undoApply}
              disabled={undoing}
              className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {undoing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Undo2 className="size-3.5" />
              )}
              {t("rules.apply.undo")}
            </button>
          )}
        </div>
      )}

      {edit && (
        <RuleEditor
          edit={edit}
          setEdit={setEdit}
          onSave={save}
          onCancel={() => setEdit(null)}
          saving={saving}
          error={error}
          t={t}
        />
      )}

      {rules === null ? (
        <div className="flex items-center gap-2 p-4 text-sm text-fg-subtle">
          <Loader2 className="size-4 animate-spin" />
          {t("rules.loading")}
        </div>
      ) : rules.length === 0 && !edit ? (
        <p className="p-4 text-sm text-fg-subtle">{t("rules.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((r, i) => {
            const color = r.actions.find((a) => a.type === "color")?.color;
            const has = (type: RuleAction["type"]) =>
              r.actions.some((a) => a.type === type);
            return (
              <li
                key={r.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2",
                  !r.enabled && "opacity-50",
                )}
              >
                {color ? (
                  <span
                    className="size-4 shrink-0 rounded-full"
                    style={{ backgroundColor: contactColorHex(color) }}
                    aria-hidden
                  />
                ) : (
                  <span
                    className="size-4 shrink-0 rounded-full border border-border"
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {r.name}
                    </span>
                    {has("star") && (
                      <Star
                        className="size-3.5 shrink-0 text-amber-500"
                        aria-label={t("rules.action.star")}
                      />
                    )}
                    {has("todo") && (
                      <ListTodo
                        className="size-3.5 shrink-0 text-accent"
                        aria-label={t("rules.action.todo")}
                      />
                    )}
                    {has("archive") && (
                      <Archive
                        className="size-3.5 shrink-0 text-fg-subtle"
                        aria-label={t("rules.action.archive")}
                      />
                    )}
                    {has("junk") && (
                      <Ban
                        className="size-3.5 shrink-0 text-high"
                        aria-label={t("rules.action.junk")}
                      />
                    )}
                  </div>
                  <div className="truncate text-xs text-fg-subtle">
                    {t(r.match === "all" ? "rules.match.all" : "rules.match.any")}
                    {" · "}
                    {r.conditions.map(condSummary).join(" / ")}
                  </div>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-fg-subtle">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => toggleEnabled(r)}
                  />
                  {t("rules.on")}
                </label>
                <div className="flex shrink-0 items-center">
                  <button
                    onClick={() => reorder(i, -1)}
                    disabled={i === 0}
                    title={t("rules.up")}
                    className="grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg disabled:opacity-30"
                  >
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    onClick={() => reorder(i, 1)}
                    disabled={i === rules.length - 1}
                    title={t("rules.down")}
                    className="grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg disabled:opacity-30"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                  <button
                    onClick={() => startEdit(r)}
                    title={t("rules.edit")}
                    className="grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => remove(r.id)}
                    title={t("rules.delete")}
                    className="grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-high"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const TEXT_FIELDS: RuleField[] = ["from", "subject", "recipient"];
const FROM_OPS: RuleOp[] = ["contains", "domainIs", "equals"];

function RuleEditor({
  edit,
  setEdit,
  onSave,
  onCancel,
  saving,
  error,
  t,
}: {
  edit: EditState;
  setEdit: (e: EditState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  t: (k: string) => string;
}) {
  const setCond = (i: number, patch: Partial<RuleCondition>) => {
    const conditions = edit.conditions.map((c, idx) =>
      idx === i ? { ...c, ...patch } : c,
    );
    setEdit({ ...edit, conditions });
  };

  return (
    <div className="mb-3 rounded-lg border border-accent/40 bg-surface p-3">
      <input
        value={edit.name}
        onChange={(e) => setEdit({ ...edit, name: e.target.value })}
        placeholder={t("rules.namePlaceholder")}
        className="mb-2 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
      />

      <div className="mb-2 flex items-center gap-2 text-xs">
        <select
          value={edit.match}
          onChange={(e) =>
            setEdit({ ...edit, match: e.target.value as "all" | "any" })
          }
          className="rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
        >
          <option value="all">{t("rules.match.all")}</option>
          <option value="any">{t("rules.match.any")}</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        {edit.conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
            <select
              value={c.field}
              onChange={(e) => {
                const field = e.target.value as RuleField;
                setCond(i, {
                  field,
                  op: field === "from" ? "contains" : undefined,
                  value: field === "hasAttachment" ? "yes" : "",
                });
              }}
              className="rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
            >
              {TEXT_FIELDS.concat("hasAttachment").map((f) => (
                <option key={f} value={f}>
                  {t(`rules.field.${f}`)}
                </option>
              ))}
            </select>

            {c.field === "from" && (
              <select
                value={c.op ?? "contains"}
                onChange={(e) => setCond(i, { op: e.target.value as RuleOp })}
                className="rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
              >
                {FROM_OPS.map((o) => (
                  <option key={o} value={o}>
                    {t(`rules.op.${o}`)}
                  </option>
                ))}
              </select>
            )}

            {c.field === "hasAttachment" ? (
              <select
                value={c.value ?? "yes"}
                onChange={(e) => setCond(i, { value: e.target.value })}
                className="rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
              >
                <option value="yes">{t("rules.att.yes")}</option>
                <option value="no">{t("rules.att.no")}</option>
              </select>
            ) : (
              <input
                value={c.value ?? ""}
                onChange={(e) => setCond(i, { value: e.target.value })}
                placeholder={t("rules.value")}
                className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
              />
            )}

            {edit.conditions.length > 1 && (
              <button
                onClick={() =>
                  setEdit({
                    ...edit,
                    conditions: edit.conditions.filter((_, idx) => idx !== i),
                  })
                }
                title={t("rules.delete")}
                className="grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-high"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() =>
          setEdit({ ...edit, conditions: [...edit.conditions, blankCondition()] })
        }
        className="mt-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-accent hover:bg-accent-soft"
      >
        <Plus className="size-3.5" />
        {t("rules.addCondition")}
      </button>

      {/* アクション: 色 / スター / TODO / 移動（複数可）。 */}
      <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
        <span className="text-xs font-medium text-fg-muted">
          {t("rules.actions")}
        </span>

        {/* 色（なし＝色付けしない） */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-subtle">{t("rules.color")}</span>
          <button
            type="button"
            onClick={() => setEdit({ ...edit, color: "none" })}
            title={t("rules.color.none")}
            aria-pressed={edit.color === "none"}
            className={cn(
              "grid size-4 place-items-center rounded-full border border-border text-[9px] text-fg-subtle transition-transform hover:scale-110",
              edit.color === "none"
                ? "ring-2 ring-fg/60 ring-offset-1 ring-offset-surface"
                : "",
            )}
          >
            ✕
          </button>
          {CONTACT_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setEdit({ ...edit, color: c.key })}
              title={c.labelJa}
              aria-pressed={edit.color === c.key}
              className={cn(
                "size-4 rounded-full transition-transform hover:scale-110",
                edit.color === c.key
                  ? "ring-2 ring-fg/60 ring-offset-1 ring-offset-surface"
                  : "",
              )}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>

        {/* スター / TODO（受信時に自動適用・非破壊） */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={edit.star}
              onChange={(e) => setEdit({ ...edit, star: e.target.checked })}
            />
            <Star className="size-3.5 text-amber-500" />
            {t("rules.action.star")}
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={edit.todo}
              onChange={(e) => setEdit({ ...edit, todo: e.target.checked })}
            />
            <ListTodo className="size-3.5 text-accent" />
            {t("rules.action.todo")}
          </label>
        </div>

        {/* 移動（アーカイブ / 迷惑メール・「今すぐ適用」でのみ実行） */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-fg-subtle">{t("rules.action.move")}</span>
          <select
            value={edit.move}
            onChange={(e) =>
              setEdit({ ...edit, move: e.target.value as MoveAction })
            }
            className="rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
          >
            <option value="none">{t("rules.move.none")}</option>
            <option value="archive">{t("rules.action.archive")}</option>
            <option value="junk">{t("rules.action.junk")}</option>
          </select>
        </div>

        <p className="text-[11px] text-fg-subtle">{t("rules.actions.hint")}</p>
      </div>

      {error && <p className="mt-2 text-xs text-high">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {t("rules.save")}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-accent hover:text-accent"
        >
          {t("rules.cancel")}
        </button>
      </div>
    </div>
  );
}
