import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { PROJECTS_SYSTEM, projectsContext } from "@/lib/ai/prompts";
import { PiiMasker, auditOutgoing } from "@/lib/ai/pii";
import { cachedList, logAiUsage } from "@/lib/db";
import { listAccounts } from "@/lib/email/accounts";
import { getProjectHub, saveProjectHub } from "@/lib/store";
import type { Email, Project, ProjectHub } from "@/lib/types";

export const maxDuration = 60;

/** GET → the saved project hub (pull型: generated on demand, not per view). */
export async function GET() {
  return NextResponse.json(await getProjectHub());
}

const schema = z.object({
  projects: z.array(
    z.object({
      name: z.string().describe("案件名（簡潔に）"),
      tag: z.string().describe("区分・カテゴリ（短く）").optional(),
      parties: z
        .array(
          z.object({
            org: z.string().describe("相手先の会社・組織名"),
            person: z.string().describe("担当者名").optional(),
          }),
        )
        .describe("相手先（複数可）"),
      status: z.enum(["進行中", "要確認", "完了"]),
      statusLabel: z.string().describe("進捗の一言（例: NDA締結・提案準備）"),
      pct: z.number().min(0).max(100).describe("進捗率の推定"),
      priority: z.enum(["高", "中", "低"]),
      due: z.string().describe("期限・次の予定（あれば。例: 打合せ 7/30 10:00）").optional(),
      next: z.string().describe("次アクション（具体的に）"),
      memo: z.string().describe("備考（推定である旨など）").optional(),
    }),
  ),
});

/**
 * POST → regenerate the hub from recent local mail. Reads the SQLite cache
 * (never the provider directly), masks structured PII before the AI call, and
 * saves the result to `.data/projects.json` (実データは端末外に出さない).
 */
export async function POST() {
  const cfg = await loadAIConfig();
  if (!cfg.configured) {
    return NextResponse.json({ error: "AIキーが未設定です（接続設定から設定してください）" }, { status: 400 });
  }

  // 1) Gather candidate threads from the cache (inbox + archive), newest message
  //    per conversation. A busy inbox is mostly newsletters/notifications, so we
  //    RANK by conversation depth + attachments (real work = back-and-forth /
  //    files) before recency, then take the top 60 within ~60 days. This keeps
  //    the AI focused on actual projects instead of one-off blasts.
  const accounts = (await listAccounts()).map((a) => a.key);
  const pool: Email[] = [...cachedList(accounts, "inbox", 800), ...cachedList(accounts, "archived", 400)];
  const count = new Map<string, number>();
  const byThread = new Map<string, Email>();
  for (const e of pool) {
    count.set(e.threadId, (count.get(e.threadId) ?? 0) + 1);
    const cur = byThread.get(e.threadId);
    if (!cur || +new Date(e.date) > +new Date(cur.date)) byThread.set(e.threadId, e);
  }
  const since = Date.now() - 60 * 864e5;
  const threads = [...byThread.values()]
    .filter((e) => +new Date(e.date) >= since)
    .map((e) => ({ e, score: (count.get(e.threadId) ?? 1) * 10 + (e.hasAttachment ? 6 : 0) }))
    .sort((a, b) => b.score - a.score || +new Date(b.e.date) - +new Date(a.e.date))
    .slice(0, 60)
    .map((x) => x.e)
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));

  if (!threads.length) {
    return NextResponse.json({ error: "対象メールが見つかりませんでした（キャッシュが空の可能性）" }, { status: 400 });
  }

  try {
    // Structured PII (mail/phone) masked before the AI call, restored on output.
    // NOTE: 人名・社名はデモでは素通り（NERは60スレッドで重いため）。本番運用では
    // nerMask 相当の適用を検討する。
    const masker = new PiiMasker();
    const rows = threads.map((e) => ({
      date: e.date,
      from: `${e.from.name ?? ""} <${cfg.piiMask ? masker.mask(e.from.email) : e.from.email}>`.trim(),
      subject: cfg.piiMask ? masker.mask(e.subject) : e.subject,
      snippet: cfg.piiMask ? masker.mask(e.snippet) : e.snippet,
    }));
    const prompt = projectsContext(rows);

    const { object, usage } = await generateObject({
      model: resolveModel(cfg),
      maxOutputTokens: 4000,
      schema,
      system: PROJECTS_SYSTEM,
      prompt,
    });

    const logged = `[system]\n${PROJECTS_SYSTEM}\n\n[prompt]\n${prompt}`;
    logAiUsage("projects", cfg.model, usage?.inputTokens, usage?.outputTokens, {
      prompt: logged,
      response: JSON.stringify(object, null, 2),
      maskAudit: cfg.piiMask ? auditOutgoing("projects", masker, logged) : undefined,
    });

    // Restore any masked tokens the model echoed back, then materialize.
    const un = (s?: string) => (s ? masker.unmask(s) : s);
    const generatedAt = new Date().toISOString();
    const projects: Project[] = object.projects.map((p, i) => ({
      id: String(i),
      name: un(p.name) ?? "",
      tag: un(p.tag),
      parties: p.parties.map((pt) => ({ org: un(pt.org) ?? "", person: un(pt.person) })),
      status: p.status,
      statusLabel: un(p.statusLabel) ?? "",
      pct: Math.max(0, Math.min(100, Math.round(p.pct))),
      priority: p.priority,
      due: un(p.due),
      next: un(p.next) ?? "",
      memo: un(p.memo),
      updated: generatedAt,
    }));

    const hub: ProjectHub = { projects, generatedAt };
    await saveProjectHub(hub);
    return NextResponse.json(hub);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "生成に失敗しました" },
      { status: 500 },
    );
  }
}
