import { NextResponse } from "next/server";
import { listRules, saveRule, deleteRule, reorderRules } from "@/lib/store";
import type {
  ContactColor,
  RuleAction,
  RuleCondition,
  RuleField,
  RuleOp,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * メール仕分けルール（Mac メール風 Rules）。local-first: .data にのみ保存。
 * - GET    → 全ルール（優先度順）
 * - POST   → 1件 upsert（id 無しは新規）
 * - PUT    → { ids } で並べ替え（優先度の振り直し）
 * - DELETE → ?id=... で1件削除
 */

const FIELDS: RuleField[] = ["from", "subject", "recipient", "hasAttachment"];
const OPS: RuleOp[] = ["contains", "domainIs", "equals"];
const COLORS: ContactColor[] = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
];

function parseConditions(raw: unknown): RuleCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: RuleCondition[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const c = r as Record<string, unknown>;
    const field = c.field as RuleField;
    if (!FIELDS.includes(field)) continue;
    if (field === "hasAttachment") {
      out.push({ field, value: c.value === "no" ? "no" : "yes" });
    } else {
      const value = typeof c.value === "string" ? c.value : "";
      if (!value.trim()) continue; // drop empty text conditions
      const op =
        field === "from" && OPS.includes(c.op as RuleOp)
          ? (c.op as RuleOp)
          : "contains";
      out.push({ field, op, value });
    }
  }
  return out;
}

function parseActions(raw: unknown): RuleAction[] {
  if (!Array.isArray(raw)) return [];
  const out: RuleAction[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const a = r as Record<string, unknown>;
    if (a.type === "color" && COLORS.includes(a.color as ContactColor)) {
      out.push({ type: "color", color: a.color as ContactColor });
    }
  }
  return out;
}

export async function GET() {
  return NextResponse.json({ rules: await listRules() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name が必要です" }, { status: 400 });
  }
  const conditions = parseConditions(body.conditions);
  const actions = parseActions(body.actions);
  if (conditions.length === 0) {
    return NextResponse.json(
      { error: "条件を1つ以上指定してください" },
      { status: 400 },
    );
  }
  if (actions.length === 0) {
    return NextResponse.json(
      { error: "アクション（色）を指定してください" },
      { status: 400 },
    );
  }
  const rules = await saveRule({
    id: typeof body.id === "string" ? body.id : undefined,
    name: body.name,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    match: body.match === "any" ? "any" : "all",
    conditions,
    actions,
  });
  return NextResponse.json({ rules });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    ids?: unknown;
  } | null;
  if (!body || !Array.isArray(body.ids)) {
    return NextResponse.json({ error: "ids が必要です" }, { status: 400 });
  }
  const ids = body.ids.filter((x): x is string => typeof x === "string");
  return NextResponse.json({ rules: await reorderRules(ids) });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  }
  return NextResponse.json({ rules: await deleteRule(id) });
}
