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

/**
 * Conversation history block for reply drafting: recent messages oldest
 * first, bodies truncated so a long thread can't blow up the prompt.
 */
export function historyContext(history: Email[], excludeId?: string, max = 6): string {
  const items = history.filter((m) => m.id !== excludeId).slice(-max);
  if (!items.length) return "";
  return items
    .map((m) => {
      const who = m.state === "sent" ? "自分" : formatAddr(m.from);
      const body = m.body.trim().replace(/\n{3,}/g, "\n\n");
      const clipped = body.length > 500 ? `${body.slice(0, 500)}…（以下略）` : body;
      return [`▼ ${who}（${m.date}）`, clipped].join("\n");
    })
    .join("\n\n");
}

export const REPLY_SYSTEM = `あなたはプロのメールアシスタントです。受信したメールに対する返信の下書きを作成します。

ルール:
- 受信メールと同じ言語で書く（日本語のメールには日本語で返信）。
- 件名（subject）と本文（body）を返す。件名は通常 "Re: 元の件名"。
- 本文は自然で簡潔、礼儀正しく、要点を押さえる。冗長な定型文は避ける。
- 「これまでのやりとり」がある場合は文脈を踏まえる（決まった日程・合意事項・未解決の論点を尊重し、既に答えた質問を蒸し返さない）。
- 元メールの引用（">"付きの再掲）は本文に含めない。引用はアプリが本文の下に自動で付与する。
- 不明な事実は創作しない。日付・金額・固有名詞を勝手に作らない。
- 署名やプレースホルダ（[あなたの名前] 等）は最小限にする。`;

export const REFINE_SYSTEM = `あなたはメール下書きの編集者です。ユーザーの指示に従って下書きを修正します。

非常に重要な出力ルール:
- 出力は「修正後のメール本文だけ」。前置き・説明・コメント・引用符・コードフェンスは一切付けない。
- ユーザーの指示（例:「もっと丁寧に」「短く」「日程を月曜に」）を反映する。
- 下書き内の ">" で始まる行（元メールの引用）は一字一句変更せず、削除もしない。
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

export const SWEEP_SYSTEM = `あなたは受信箱の一掃（消し込み）を手伝うアシスタントです。
各メールの「差出人・件名・冒頭プレビュー」だけを見て、処分を3択で推奨します。

- trash: 明らかな宣伝・キャンペーン・スパム的な一斉配信（読まれない前提のもの）
- archive: 通知・ニュースレター・自動送信など、読み終わり/保存だけで良いもの
- keep: 人からの個別メール、要返信・要対応の可能性があるもの

判断に迷うものは必ず keep に倒す（誤って人のメールを片付けない）。
reason は日本語で15文字以内。`;
