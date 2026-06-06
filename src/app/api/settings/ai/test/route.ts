import { NextResponse } from "next/server";
import { generateText } from "ai";
import { loadAIConfig, modelLabel, resolveModel } from "@/lib/ai/model";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** Run a tiny generation to verify the active provider/key/model actually work. */
export async function POST() {
  const cfg = await loadAIConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { ok: false, error: "APIキーが未設定です。保存してから接続テストしてください。" },
      { status: 400 },
    );
  }
  try {
    const { text } = await generateText({
      model: resolveModel(cfg),
      prompt: 'Reply with exactly the two characters: OK',
    });
    return NextResponse.json({ ok: true, label: modelLabel(cfg), sample: text.trim().slice(0, 60) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, label: modelLabel(cfg), error: err instanceof Error ? err.message : "接続テスト失敗" },
      { status: 502 },
    );
  }
}
