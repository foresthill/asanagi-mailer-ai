import { NextResponse } from "next/server";
import { streamText } from "ai";
import { loadActiveAIConfig, resolveModel } from "@/lib/ai/model";
import { PiiMasker } from "@/lib/ai/pii";
import { cleanForAI, splitQuoted } from "@/lib/ai/clean";

/**
 * メール本文の翻訳（閲覧用・編集ではない）。POST { text, target, part } → 訳文を
 * ストリーミング（text/plain）で返す。最初の数行がすぐ出るので、遅いローカルAIでも
 * 「戻ってくるまで待つ」感が消える。
 * - part: "main"（既定・引用を除く本文）| "quote"（過去のやりとり）
 * - target: "en" | "fr" | "ja" | "zh"
 * 構造化PIIは本番同様マスクしてから送り、訳文で復元する（local-first）。復元は
 * マスクトークンが完成した安全な部分だけ逐次行い、ストリームに乗せる。
 * レスポンスヘッダ X-Has-Quote: 1|0 で、引用部が存在するか（＝「引用も訳す」を
 * 出すべきか）をクライアントに伝える。
 */

export const maxDuration = 60;

const LANGS: Record<string, string> = {
  en: "English",
  fr: "French",
  ja: "Japanese",
  zh: "Chinese",
};

export async function POST(req: Request) {
  const { text, target, part } = (await req.json()) as {
    text?: string;
    target?: string;
    part?: "main" | "quote";
  };
  if (!text?.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const lang = LANGS[target ?? "en"] ?? "English";
  const which = part === "quote" ? "quote" : "main";

  const cfg = await loadActiveAIConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: "AIキーが未設定です（設定から接続してください）" },
      { status: 400 },
    );
  }

  // 本文と引用に分け、要求された側だけを訳す（既定は本文のみ）。
  const { main, quote } = splitQuoted(text);
  const hasQuote = quote.trim().length > 0;
  const picked = (which === "quote" ? quote : main) || cleanForAI(text);
  const source = picked.slice(0, 8000);

  if (!source.trim()) {
    // 引用が無いのに part=quote を頼まれた等。空ボディ＋ヘッダで知らせる。
    return new Response("", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-has-quote": hasQuote ? "1" : "0",
      },
    });
  }

  const masker = new PiiMasker();
  const src = cfg.piiMask ? masker.mask(source) : source;

  try {
    const result = streamText({
      model: resolveModel(cfg),
      maxOutputTokens: 2000,
      system:
        `You are a professional translator. Translate the user's email text into ${lang}. ` +
        "Output ONLY the translation — no preamble, no notes. Preserve line breaks, meaning, " +
        "tone and politeness, and render it natural in the target language. Keep any placeholder " +
        "tokens such as [EMAIL_1] or [PHONE_1] exactly as-is.",
      prompt: src,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let acc = "";
        let sent = 0; // length of unmasked text already emitted
        const flush = (final: boolean) => {
          // マスクトークンが途中で切れている末尾は保留し、完成部分だけ復元して送る。
          let safeEnd = acc.length;
          if (!final) {
            const open = acc.lastIndexOf("[");
            if (open !== -1 && acc.indexOf("]", open) === -1) safeEnd = open;
          }
          const safe = acc.slice(0, safeEnd);
          const un = cfg.piiMask ? masker.unmask(safe) : safe;
          if (un.length > sent) {
            controller.enqueue(encoder.encode(un.slice(sent)));
            sent = un.length;
          }
        };
        try {
          for await (const chunk of result.textStream) {
            acc += chunk;
            flush(false);
          }
          flush(true);
        } catch (e) {
          controller.enqueue(
            encoder.encode(
              `\n[翻訳エラー: ${e instanceof Error ? e.message : "失敗しました"}]`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-has-quote": hasQuote ? "1" : "0",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "翻訳に失敗しました" },
      { status: 500 },
    );
  }
}
