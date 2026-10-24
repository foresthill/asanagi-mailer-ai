import { NextResponse } from "next/server";
import { generateText } from "ai";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { langDirective } from "@/lib/ai/prompts";
import { PiiMasker, auditOutgoing } from "@/lib/ai/pii";
import { cleanForAI } from "@/lib/ai/clean";
import { logAiUsage } from "@/lib/db";
import type { Email } from "@/lib/types";

export const maxDuration = 60;

/**
 * 読む時のAI「このメールについて質問」(Q&A)。開いているメール（または会話）を
 * 文脈に、ユーザーの自由質問へ答える。要約と同じく PII マスクの関所を通し、
 * クリック時だけ呼ぶ（自動生成しない）。回答生成なのでメインモデルを使う。
 */
const MAX_MESSAGES = 40;
// 1通表示なら本文を丸ごと（長いメルマガも全部）見られるよう大きく取る。会話
// （複数通）のときは肥大化を防ぐため1通あたりは控えめにする（返信は普通短い）。
const BODY_CAP_SINGLE = 50000;
const BODY_CAP_THREAD = 4000;
const MAX_QUESTION = 1000;

const SYSTEM = `あなたはメールを読む人の助手です。与えられたメール（または会話）の内容だけを根拠に、ユーザーの質問へ簡潔に答えます。
- 本文に書かれていないことは推測せず「メールには書かれていません」と答える。
- 日付・金額・担当・依頼内容など、具体は本文から正確に引く。
- 長文にせず、要点を先に。箇条書きが向く場合は使う。`;

export async function POST(req: Request) {
  const { messages, question, locale } = (await req.json()) as {
    messages: Email[];
    question: string;
    locale?: string;
  };
  if (!messages?.length) {
    return NextResponse.json({ error: "メールがありません" }, { status: 400 });
  }
  const q = (question ?? "").trim().slice(0, MAX_QUESTION);
  if (!q) {
    return NextResponse.json({ error: "質問を入力してください" }, { status: 400 });
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

  const ordered = [...messages].sort(
    (a, b) => +new Date(a.date) - +new Date(b.date),
  );
  const window = ordered.slice(-MAX_MESSAGES);
  const bodyCap = window.length > 1 ? BODY_CAP_THREAD : BODY_CAP_SINGLE;

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
          e.state === "sent" ? "自分" : m(e.from?.name) || m(e.from?.email);
        const date = e.date ? new Date(e.date).toLocaleString("ja-JP") : "";
        // HTMLメールは text/plain(e.body) が目次だけのことが多い。記事全文は e.html
        // 側にあるので、HTMLがあればそれを本文化して使う（cleanForAIがタグを除去）。
        const body = m(cleanForAI(e.html || e.body || e.snippet)).slice(0, bodyCap);
        return `--- [${i + 1}] ${date} / ${who} / 件名: ${m(e.subject)}\n${body}`;
      })
      .join("\n\n");

    const prompt = [
      window.length > 1
        ? `以下は1つの会話（古い順・${window.length}通）です。`
        : "以下はメール1通です。",
      transcript,
      "",
      `質問: ${m(q)}`,
    ].join("\n");

    const system = SYSTEM + langDirective(locale);
    const { text, usage } = await generateText({
      model: resolveModel(cfg),
      maxOutputTokens: 1200,
      system,
      prompt,
    });

    const answer = masker.unmask(text);

    const logged = `[system]\n${system}\n\n[prompt]\n${prompt}`;
    logAiUsage("ask", cfg.model, usage?.inputTokens, usage?.outputTokens, {
      prompt: logged,
      response: answer,
      maskAudit: cfg.piiMask ? auditOutgoing("ask", masker, logged) : undefined,
    });

    return NextResponse.json({ answer });
  } catch (err) {
    console.warn("[ask] AI失敗:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        error:
          "回答を作成できませんでした（AIの呼び出しに失敗）。時間をおいて再度お試しください。",
      },
      { status: 500 },
    );
  }
}
