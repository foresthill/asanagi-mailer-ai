import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { DIGEST_SYSTEM, langDirective } from "@/lib/ai/prompts";
import { PiiMasker, auditOutgoing } from "@/lib/ai/pii";
import { logAiUsage } from "@/lib/db";
import type { Email } from "@/lib/types";

export const maxDuration = 60;

/**
 * 会話（スレッド）の経緯ダイジェスト: スレッド全体を PII マスクの関所を通して
 * AI に渡し、「要点／決定事項／未決／次アクション／キー日付／登場人物」を構造化して
 * 返す。クリック時だけ呼ばれる（自動生成しない＝勝手に課金されない）。
 * BYOK/オンプレ Ollama いずれでも動く（resolveModel）。品質重視でメインモデルを使う。
 */
const schema = z.object({
  summary: z.string().describe("会話の経緯を2〜4行で"),
  decisions: z.array(z.string()).describe("決まったこと（合意・確定事項）"),
  open: z.array(z.string()).describe("未決・宿題・保留中の論点"),
  nextActions: z
    .array(z.string())
    .describe("次にやるべきこと（担当が分かれば添える）"),
  keyDates: z
    .array(z.string())
    .describe("重要な日付・締切（例: 9/14 会議, 月末納品）"),
  participants: z
    .array(z.string())
    .describe("主な登場人物と役割（分かる範囲で）"),
});

export type ThreadDigest = z.infer<typeof schema>;

/** Cap the payload: newest ~40 messages, each body trimmed — controls cost. */
const MAX_MESSAGES = 40;
const MAX_BODY = 1200;

export async function POST(req: Request) {
  const { messages, locale } = (await req.json()) as {
    messages: Email[];
    locale?: string;
  };
  if (!messages?.length) {
    return NextResponse.json({ error: "スレッドが空です" }, { status: 400 });
  }

  const cfg = await loadAIConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      {
        error:
          "AIが未設定です（接続設定でキー、またはローカルOllamaのエンドポイントを設定してください）",
      },
      { status: 400 },
    );
  }

  // Oldest → newest; keep the most recent window if very long.
  const ordered = [...messages].sort(
    (a, b) => +new Date(a.date) - +new Date(b.date),
  );
  const window = ordered.slice(-MAX_MESSAGES);

  try {
    const masker = new PiiMasker();
    if (cfg.piiMask && cfg.nerMask) {
      await masker.learnEntities(
        window.flatMap((m) => [m.from?.name, m.subject, m.body || m.snippet]),
      );
    }
    const m = (s: string | undefined) =>
      cfg.piiMask ? masker.mask(s ?? "") : (s ?? "");

    const transcript = window
      .map((e, i) => {
        const who =
          e.state === "sent"
            ? "自分"
            : `${m(e.from?.name) || m(e.from?.email)}`;
        const date = e.date ? new Date(e.date).toLocaleString("ja-JP") : "";
        const body = m(e.body || e.snippet).slice(0, MAX_BODY);
        return `--- [${i + 1}] ${date} / ${who} / 件名: ${m(e.subject)}\n${body}`;
      })
      .join("\n\n");

    const prompt = [
      `以下は1つの会話（古い順・${window.length}通）です。経緯を後から思い出せるように要約してください。`,
      "",
      transcript,
    ].join("\n");

    const system = DIGEST_SYSTEM + langDirective(locale);
    const { object, usage } = await generateObject({
      model: resolveModel(cfg), // 品質重視でメインモデル
      maxOutputTokens: 2000,
      schema,
      system,
      prompt,
    });

    // Unmask every string in the structured output back to real names.
    const u = (s: string) => masker.unmask(s);
    const digest: ThreadDigest = {
      summary: u(object.summary),
      decisions: object.decisions.map(u),
      open: object.open.map(u),
      nextActions: object.nextActions.map(u),
      keyDates: object.keyDates.map(u),
      participants: object.participants.map(u),
    };

    const logged = `[system]\n${system}\n\n[prompt]\n${prompt}`;
    logAiUsage("digest", cfg.model, usage?.inputTokens, usage?.outputTokens, {
      prompt: logged,
      response: JSON.stringify(digest, null, 2),
      maskAudit: cfg.piiMask
        ? auditOutgoing("digest", masker, logged)
        : undefined,
    });

    return NextResponse.json({ digest });
  } catch (err) {
    console.warn(
      "[thread-digest] AI失敗:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      {
        error:
          "要約を作成できませんでした（AIの呼び出しに失敗）。時間をおいて再度お試しください。",
      },
      { status: 500 },
    );
  }
}
