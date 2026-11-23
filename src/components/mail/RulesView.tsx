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
} from "lucide-react";
import type {
  ContactColor,
  MailRule,
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

type EditState = {
  id?: string;
  name: string;
  match: "all" | "any";
  conditions: RuleCondition[];
  color: ContactColor;
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
  };
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
      color: r.actions.find((a) => a.type === "color")?.color ?? "orange",
    });
  };

  const save = async () => {
    if (!edit) return;
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
          actions: [{ type: "color", color: edit.color }],
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
          onClick={startAdd}
          className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          <Plus className="size-4" />
          {t("rules.add")}
        </button>
      </header>

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
            return (
              <li
                key={r.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2",
                  !r.enabled && "opacity-50",
                )}
              >
                <span
                  className="size-4 shrink-0 rounded-full"
                  style={{ backgroundColor: contactColorHex(color) }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.name}</div>
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

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-fg-subtle">{t("rules.color")}</span>
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
