import type { Email, ImportanceSignal } from "@/lib/types";

function formatAddr(a: { name?: string; email: string }): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

/** Render an email into a compact context block for the model. */
export function emailContext(email: Email): string {
  return [
    `From: ${formatAddr(email.from)}`,
    `To: ${email.to.map(formatAddr).join(", ")}`,
    `Date: ${email.date}`,
    `Subject: ${email.subject}`,
    "",
    email.body.trim(),
  ].join("\n");
}

export const REPLY_SYSTEM = `あなたはプロのメールアシスタントです。受信したメールに対する返信の下書きを作成します。

ルール:
- 受信メールと同じ言語で書く（日本語のメールには日本語で返信）。
- 件名（subject）と本文（body）を返す。件名は通常 "Re: 元の件名"。
- 本文は自然で簡潔、礼儀正しく、要点を押さえる。冗長な定型文は避ける。
- 不明な事実は創作しない。日付・金額・固有名詞を勝手に作らない。
- 署名やプレースホルダ（[あなたの名前] 等）は最小限にする。`;

export const REFINE_SYSTEM = `あなたはメール下書きの編集者です。ユーザーの指示に従って下書きを修正します。

非常に重要な出力ルール:
- 出力は「修正後のメール本文だけ」。前置き・説明・コメント・引用符・コードフェンスは一切付けない。
- ユーザーの指示（例:「もっと丁寧に」「短く」「日程を月曜に」）を反映する。
- 言語は元の下書きと同じに保つ。
- 事実を創作しない。`;

export const CLASSIFY_SYSTEM = `あなたはユーザーの受信メールの重要度を判定するアシスタントです。
重要度は high / normal / low の3段階。判定の根拠を日本語で一文添えます。

判断材料:
- 差出人との関係、緊急性、アクション要否、締切の有無。
- 下記「学習済みシグナル」はユーザーが過去に示した好みです。強く尊重してください。`;

export function classifyContext(email: Email, signals: ImportanceSignal[]): string {
  const learned =
    signals.length > 0
      ? signals
          .map((s) => `- ${s.kind}:"${s.pattern}" → ${s.importance} (確信度 ${s.weight})`)
          .join("\n")
      : "（まだ学習データはありません）";

  return [
    "## 学習済みシグナル",
    learned,
    "",
    "## 判定対象メール",
    emailContext(email),
  ].join("\n");
}
