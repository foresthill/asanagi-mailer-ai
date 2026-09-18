import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { SEARCH_DIGEST_SYSTEM } from "@/lib/ai/prompts";
import { PiiMasker, auditOutgoing } from "@/lib/ai/pii";
import { logAiUsage } from "@/lib/db";
import type { Email } from "@/lib/types";

export const maxDuration = 60;

/**
 * AI検索（経緯を辿る）: キーワードで集めた候補メール群を PII マスクの関所を通して
 * AI に渡し、検索語に対する「経緯（要約＋時系列＋要点）」と、特に根拠になるメール
 * （番号）を構造化して返す。クリック時だけ呼ぶ（自動生成しない＝勝手に課金しない）。
 * 表示側は要約を上に、根拠メールを下にずらり並べる（社内wiki/Dify的ナレッジビュー）。
 */
const schema = z.object({
  summary: z.string().describe("検索語に対する経緯の要約を3〜5行で（結論・現状が分かるように）"),
  timeline: z
    .array(z.object({ when: z.string().describe("時点（例: 9/14, 先週）"), what: z.string() }))
    .describe("時系列の要点（古い順）"),
  points: z.array(z.string()).describe("押さえどころ・注意点（未決や次アクションを含む）"),
  relevant: z
    .array(
      z.object({
        index: z.number().int().describe("特に根拠になるメールの番号 [1..N]"),
        reason: z.string().describe("なぜ根拠か（短く）"),
      }),
    )
    .describe("経緯の根拠として重要なメールを番号で（多くても5件程度）"),
});

/** Cap the corpus: newest ~30 hits, each body trimmed — controls cost. */
const MAX_MESSAGES = 30;
const MAX_BODY = 800;

export async function POST(req: Request) {
  const { query, messages } = (await req.json()) as { query?: string; messages?: Email[] };
  const q = (query ?? "").trim();
  if (!q) return NextResponse.json({ error: "検索語がありません" }, { status: 400 });
  if (!messages?.length) {
    return NextResponse.json({ error: "対象メールがありません" }, { status: 400 });
  }

  const cfg = await loadAIConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: "AIが未設定です（接続設定でキー、またはローカルOllamaのエンドポイントを設定してください）" },
      { status: 400 },
    );
  }

  // Keep the retrieval order (relevance/date as given), cap to the newest window.
  const window = messages.slice(0, MAX_MESSAGES);

  try {
    const masker = new PiiMasker();
    if (cfg.piiMask && cfg.nerMask) {
      await masker.learnEntities(window.flatMap((m) => [m.from?.name, m.subject, m.body || m.snippet]));
    }
    const m = (s: string | undefined) => (cfg.piiMask ? masker.mask(s ?? "") : (s ?? ""));

    const transcript = window
      .map((e, i) => {
        const who = e.state === "sent" ? "自分" : `${m(e.from?.name) || m(e.from?.email)}`;
        const date = e.date ? new Date(e.date).toLocaleString("ja-JP") : "";
        const body = m(e.body || e.snippet).slice(0, MAX_BODY);
        return `--- [${i + 1}] ${date} / ${who} / 件名: ${m(e.subject)}\n${body}`;
      })
      .join("\n\n");

    const prompt = [
      `検索語:「${m(q)}」`,
      `以下は検索語で見つかった候補メール ${window.length} 通です（番号付き）。`,
      "この件の経緯を、後から思い出せるように要約してください。根拠になるメールは番号で示してください。",
      "",
      transcript,
    ].join("\n");

    const { object, usage } = await generateObject({
      model: resolveModel(cfg), // 品質重視でメインモデル
      maxOutputTokens: 2000,
      schema,
      system: SEARCH_DIGEST_SYSTEM,
      prompt,
    });

    const u = (s: string) => masker.unmask(s);
    // Map AI's 1-based indices back to real message ids (drop out-of-range).
    const sources = object.relevant
      .filter((r) => r.index >= 1 && r.index <= window.length)
      .map((r) => ({ id: window[r.index - 1].id, reason: u(r.reason) }));

    const digest = {
      summary: u(object.summary),
      timeline: object.timeline.map((t) => ({ when: u(t.when), what: u(t.what) })),
      points: object.points.map(u),
      sources,
    };

    const logged = `[system]\n${SEARCH_DIGEST_SYSTEM}\n\n[prompt]\n${prompt}`;
    logAiUsage("search-digest", cfg.model, usage?.inputTokens, usage?.outputTokens, {
      prompt: logged,
      response: JSON.stringify(digest, null, 2),
      maskAudit: cfg.piiMask ? auditOutgoing("search-digest", masker, logged) : undefined,
    });

    return NextResponse.json({ digest });
  } catch (err) {
    console.warn("[search-digest] AI失敗:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "経緯を作成できませんでした（AIの呼び出しに失敗）。時間をおいて再度お試しください。" },
      { status: 500 },
    );
  }
}

export type SearchDigest = {
  summary: string;
  timeline: { when: string; what: string }[];
  points: string[];
  sources: { id: string; reason: string }[];
};
