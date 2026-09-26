import { NextResponse } from "next/server";
import { listTodos, addTodo, updateTodo, removeTodo } from "@/lib/store";
import type { TodoItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * TODO（「あとで」）— メールをタスク化。local-first: .data にのみ保存。
 * - GET            → 全 TODO
 * - POST  { item } → 追加（既存はそのまま）
 * - PATCH { id, due?, done? } → 更新
 * - DELETE ?id=... → 削除
 */
export async function GET() {
  return NextResponse.json({ todos: await listTodos() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    item?: Omit<TodoItem, "createdAt">;
  } | null;
  if (!body?.item?.id) {
    return NextResponse.json({ error: "item.id が必要です" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, todos: await addTodo(body.item) });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    due?: string | null;
    done?: boolean;
  } | null;
  if (!body?.id) {
    return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  }
  const patch: { due?: string; done?: boolean } = {};
  if ("due" in body) patch.due = body.due ?? undefined;
  if ("done" in body) patch.done = body.done;
  return NextResponse.json({
    ok: true,
    todos: await updateTodo(body.id, patch),
  });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, todos: await removeTodo(id) });
}
