import { NextResponse } from "next/server";
import { generateText } from "ai";
import { loadAIConfig, resolveModel } from "@/lib/ai/model";
import { PiiMasker } from "@/lib/ai/pii";

/**
 * メール本文の翻訳（閲覧用・編集ではない）。POST { text, target } → 訳文。
 * target: "en" | "fr" | "ja" など。構造化PIIは本番同様マスクしてから送り、訳文で
 * 復元する（local-first）。返信生成などと同じメインモデルを使う。
 */

export const maxDuration = 30;

const LANGS: Record<string, string> = {
  en: "English",
  fr: "French",
  ja: "Japanese",
  zh: "Chinese",
};

export async function POST(req: Request) {
  const { text, target } = (await req.json()) as {
    text?: string;
    target?: string;
  };
  if (!text?.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const lang = LANGS[target ?? "en"] ?? "English";

  const cfg = await loadAIConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: "AIキーが未設定です（設定から接続してください）" },
      { status: 400 },
    );
  }

  try {
    const masker = new PiiMasker();
    const src = cfg.piiMask
      ? masker.mask(text.slice(0, 8000))
      : text.slice(0, 8000);
    const { text: out } = await generateText({
      model: resolveModel(cfg),
      maxOutputTokens: 2000,
      system:
        `You are a professional translator. Translate the user's email text into ${lang}. ` +
        "Output ONLY the translation — no preamble, no notes. Preserve line breaks, meaning, " +
        "tone and politeness, and render it natural in the target language. Keep any placeholder " +
        "tokens such as [EMAIL_1] or [PHONE_1] exactly as-is.",
      prompt: src,
    });
    return NextResponse.json({ text: cfg.piiMask ? masker.unmask(out) : out });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "翻訳に失敗しました" },
      { status: 500 },
    );
  }
}
