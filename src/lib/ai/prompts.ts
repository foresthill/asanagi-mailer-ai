import type { Email, ImportanceSignal } from "@/lib/types";
import type { PiiMasker } from "./pii";

function formatAddr(a: { name?: string; email: string }): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

/** UI-language names for the output-language directive (user-facing AI output). */
const LANG_NAME: Record<string, string> = {
  ja: "日本語",
  en: "English",
  fr: "français",
  zh: "简体中文",
};

/**
 * Strong output-language directive appended to user-facing generation prompts
 * (digest / search-digest / projects / importance reason / sweep reason). These
 * are read by the USER, so they must follow the UI locale — not the language of
 * the source mail. (Reply/subject drafting is different: it matches the
 * correspondent's language and is handled in REPLY_SYSTEM/SUBJECT_SYSTEM.)
 * Falls back to Japanese for an unknown/absent locale.
 */
export function langDirective(locale?: string): string {
  const name = LANG_NAME[locale ?? "ja"] ?? LANG_NAME.ja;
  return `\n\n## 出力言語（最優先）\nユーザーの表示言語は ${name} です。要約・説明・理由など、ユーザーに見せる文章は必ず ${name} で書いてください。ただしマスクトークン（[NAME_1] や [EMAIL_2] 等）・固有名詞・原文引用はそのまま残します。`;
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
export function historyContext(
  history: Email[],
  excludeId?: string,
  max = 6,
): string {
  const items = history.filter((m) => m.id !== excludeId).slice(-max);
  if (!items.length) return "";
  return items
    .map((m) => {
      const who = m.state === "sent" ? "自分" : formatAddr(m.from);
      const body = m.body.trim().replace(/\n{3,}/g, "\n\n");
      const clipped =
        body.length > 500 ? `${body.slice(0, 500)}…（以下略）` : body;
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

/**
 * Fix the message PERSPECTIVE (who is writing, to whom) — the single most
 * dangerous place to get wrong: if the model infers perspective from the target
 * message it will impersonate the OTHER party (e.g. draft the recipient's reply,
 * signed as them). Sending that = a real incident. So we pin the writer to the
 * account owner and add a hard "never impersonate the counterparty" guard.
 *
 * Two modes:
 * - "reply": the target is a message FROM the other party → reply as the owner.
 * - "followup": the target is the owner's OWN sent mail with no reply yet →
 *   this is NOT a reply (there is nothing to reply to); it's an additional
 *   message / reminder to the same recipients, written as the owner. Framing it
 *   as a "reply" is what makes the model hallucinate the recipient's response.
 *
 * @param selfName        the account owner's display name (the ONLY valid signer)
 * @param counterpartyName who we are writing TO (the forbidden identity to sign as)
 * @param mode            "reply" (default) or "followup"
 * @param signature       user-authored 名乗り/署名 (per-account); refines the sign-off
 */
export function replyPerspective(opts: {
  selfName?: string;
  counterpartyName?: string;
  mode?: "reply" | "followup";
  signature?: string;
}): string {
  const name = opts.selfName?.trim();
  const other = opts.counterpartyName?.trim();
  const sig = opts.signature?.trim();
  const me = name ? `「${name}」本人` : "このメールアカウントの持ち主本人";
  const lines = ["", "## あなた（送信者）について"];

  if (opts.mode === "followup") {
    lines.push(
      `あなたは${me}です。下の「元メール」は、あなたが既に送信したもので、相手からの返信はまだありません。`,
      `これは「返信」ではありません。同じ宛先（${other ? `「${other}」` : "元メールの宛先"}）への、あなたからの追加連絡（フォローアップ／リマインド）です。`,
      `宛名は相手、差出人・署名はあなた自身（${name ?? "アカウント本人"}）。相手の受領返事や相手の発言を代筆してはいけません。`,
    );
  } else {
    lines.push(
      `あなたは${me}として、このスレッドの相手（あなた以外の参加者${other ? `＝「${other}」` : ""}）に返信します。宛名は相手、署名はあなた自身です。`,
    );
  }

  // Hard guard — belt-and-suspenders against identity flip (the incident case).
  lines.push(
    `【厳守】あなたは相手（${other ?? "宛先の人物"}）になりすましてはいけません。相手の氏名・会社を名乗らず、相手からのメールを代筆せず、署名は必ず「${name ?? "あなた自身"}」にしてください。`,
  );

  if (sig) lines.push(`名乗り・署名は次を用いてください: ${sig}`);
  return lines.join("\n");
}

export const PROJECTS_SYSTEM = `あなたは、業務メールの履歴から「進行中の案件（プロジェクト）」を抽出して整理するアシスタントです。
与えられたスレッド要約（差出人・件名・冒頭）だけを根拠に、アクティブな案件を洗い出します。

抽出ルール:
- 1案件 = 1つの取引・提案・実証・納品など、継続したまとまり。関連スレッドは1案件にまとめる。
- 宣伝メール・メルマガ・通知・請求書の自動配信は案件にしない（人と進めている仕事だけ）。
- 各案件について、相手先（会社・担当）、進捗（一言＋0-100%の推定）、優先度（高/中/低）、
  次アクション（具体的に）、必要なら期限、備考を出す。
- 状態は「進行中」（動いている）/「要確認」（案件化するか精査が要る）/「完了」。
- 根拠が薄い項目は断定せず、推定である旨を statusLabel/memo に控えめに示す。
- 事実を創作しない。件名・要約に無い固有名詞や数値を作らない。
- 出力は指定された言語で書く。10〜15件程度に厳選する（重要・活発なものを優先）。
- 各案件で根拠にしたスレッドの番号（下の一覧の先頭の数字）を sources に入れる
  （最新メールへ飛べるようにするため。複数可）。`;

/** Compact, masked thread summaries for the projects prompt (subject + snippet
 *  + masked sender/date). One line per thread — bodies are NOT sent whole. */
export function projectsContext(
  threads: { date: string; from: string; subject: string; snippet: string }[],
): string {
  return [
    "## スレッド要約（新しい順）",
    ...threads.map(
      (t, i) =>
        `${i + 1}. [${t.date.slice(0, 10)}] From: ${t.from}\n   件名: ${t.subject}\n   冒頭: ${t.snippet.slice(0, 160)}`,
    ),
  ].join("\n");
}

export const SUBJECT_SYSTEM = `あなたはメールの件名を考えるアシスタントです。与えられた本文にふさわしい件名を1つだけ作ります。

出力ルール:
- 出力は「件名の文字列だけ」。前置き・引用符・コードフェンス・説明は一切付けない。
- 本文と同じ言語で書く（日本語の本文には日本語の件名）。
- 簡潔に（目安40文字以内）。内容を端的に表す。誇張・煽り・余計な記号は避ける。
- 本文に無い事実（日付・金額・固有名詞）を創作しない。
- 返信の引用部（">"で始まる行）は要約の根拠にしてよいが、件名に「Re:」は付けない。`;

export const REFINE_SYSTEM = `あなたはメール下書きの編集者です。ユーザーの指示に従って下書きを修正します。

非常に重要な出力ルール:
- 出力は「修正後のメール本文だけ」。前置き・説明・コメント・引用符・コードフェンスは一切付けない。
- ユーザーの指示（例:「もっと丁寧に」「短く」「日程を月曜に」）を反映する。
- 下書き内の ">" で始まる行（元メールの引用）は一字一句変更せず、削除もしない。
- ユーザーが書いていない要素を勝手に足さない: 署名・フッター・会社名・日付/時刻・「以上、よろしくお願いします」等の定型句を、指示が無いのに新規追加しない。
- 言語は元の下書きと同じに保つ。
- 事実を創作しない。`;

/**
 * Inject the user's natural-language preference profile (AIへのメモ) into a
 * judgment prompt. Empty profile → no-op. The profile is user-authored
 * guidance (e.g. "上司の田中さんからは必ず重要") so it is sent as-is (not PII
 * masked); it must be respected above generic heuristics.
 */
export function profileBlock(profile: string): string {
  const p = profile.trim();
  if (!p) return "";
  return ["", "## ユーザーの嗜好メモ（最優先で尊重してください）", p].join(
    "\n",
  );
}

/**
 * Inject the user's writing-style rules (文章作成メモ) into a reply/refine
 * prompt. User-authored文体ルール (e.g. "絵文字は使わない") — sent as-is (not
 * PII masked, like profileBlock) and must override generic phrasing habits.
 */
export function writingNoteBlock(note: string): string {
  const n = note.trim();
  if (!n) return "";
  return ["", "## 文章作成のルール（ユーザー指定・最優先で守る）", n].join(
    "\n",
  );
}

export const CLASSIFY_SYSTEM = `あなたはユーザーの受信メールの重要度を判定するアシスタントです。
重要度は high / normal / low の3段階。判定の根拠を、指定された言語で一文添えます。

判断材料:
- 差出人との関係、緊急性、アクション要否、締切の有無。
- 下記「学習済みシグナル」はユーザーが過去に示した好みです。強く尊重してください。

さらに「threat」フィールドで危険性を判定します（重要度とは別軸）:
- "phishing": 実在の企業・公的機関（銀行/カード/宅配/税務署/年金/Amazon等）を装い、
  リンククリックや認証情報・カード番号の入力、偽の請求/支払いを促す詐欺メール。
  差出人の表示名と実ドメインの不一致は強い手がかり。
- "spam": 迷惑・無差別の宣伝や勧誘（危険性は低いが不要）。
- "none": 上記に該当しない通常のメール。
迷ったら "none"。フィッシングは実害があるので、確度が高いときのみ "phishing" とします。`;

export function classifyContext(
  email: Email,
  signals: ImportanceSignal[],
  masker?: PiiMasker,
): string {
  // Signal patterns are the user's learned contacts: sender addresses and
  // company domains. Mask them (consistently with the target) so this whole
  // preference list doesn't leak to the AI provider. sender→[EMAIL_n] via the
  // email regex; domain has no `@`, so use maskDomain→[DOMAIN_n].
  const maskPattern = (s: ImportanceSignal) =>
    !masker
      ? s.pattern
      : s.kind === "domain"
        ? masker.maskDomain(s.pattern)
        : masker.mask(s.pattern);
  const learned =
    signals.length > 0
      ? signals
          .map(
            (s) =>
              `- ${s.kind}:"${maskPattern(s)}" → ${s.importance} (確信度 ${s.weight})`,
          )
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

export const DIGEST_SYSTEM = `あなたは1つのメールスレッド（会話）の経緯を、後から思い出すために要約するアシスタントです。
与えられた会話（古い順）だけを根拠に、事実に忠実に、指定された言語でまとめます。

厳守:
- 会話に書かれていないことを推測・創作しない。分からないことは項目を空にする。
- 決定事項・未決・次アクションを混同しない（「決まったこと」と「まだ宿題」を分ける）。
- 誰が言ったかが重要な点は主語を明示する。日付・締切・金額など具体は落とさない。
- マスクされたトークン（[NAME_1] や [EMAIL_2] 等）はそのまま残す（勝手に人名へ戻さない）。
- 簡潔に。要点は箇条書き、summary は2〜4行。`;

export const SEARCH_DIGEST_SYSTEM = `あなたは、検索語で集められた複数のメールから「その件の経緯」を、後から思い出すために要約するアシスタントです。
与えられた候補メール（番号付き）だけを根拠に、事実に忠実に、指定された言語でまとめます。候補は別々のスレッド・別々の相手にまたがることがあります（同じ要件で担当が分かれる場合など）。

厳守:
- 候補に書かれていないことを推測・創作しない。分からないことは項目を空にする。
- 検索語に直接関係する話だけを追う（無関係な広告・通知は無視してよい）。
- 時系列（timeline）は古い順。決定事項・未決・次アクションは points に落とし込み混同しない。
- 誰が言ったかが重要な点は主語を明示する。日付・締切・金額など具体は落とさない。
- 根拠になるメールは relevant に「番号」で示す（多くても5件程度、reason は短く）。存在しない番号を書かない。
- マスクされたトークン（[NAME_1] や [EMAIL_2] 等）はそのまま残す（勝手に人名へ戻さない）。
- 簡潔に。summary は3〜5行。`;

export const SIGNATURE_SYSTEM = `あなたはメール署名から差出人の「会社・組織名」だけを抜き出すアシスタントです。
与えられたメール本文（末尾の署名を含む）を読み、差出人が所属する会社・組織名を返します。

厳守（宛名に使うため、創作は絶対禁止）:
- company は署名／本文に書かれているとおりに一字一句コピーする。「株式会社」の位置（前株／後株）もそのまま。整形・略記・敬称の付与をしない。
- 署名や本文に会社名が無い、または個人（会社に属さない）と判断される場合は company を null にする。
- 推測で会社名や前株／後株を補わない。読み取れないなら null。
- 部署・役職・住所・電話・URL・メールアドレスは company に含めない。
- マスクトークン（[EMAIL_1] や [ORG_1] 等）が混ざる場合は、それを company に含めない（含まれるなら null）。`;

export const SWEEP_SYSTEM = `あなたは受信箱の一掃（消し込み）を手伝うアシスタントです。
各メールの「差出人・件名・冒頭プレビュー」だけを見て、処分を3択で推奨します。

- trash: 明らかな宣伝・キャンペーン・スパム的な一斉配信（読まれない前提のもの）
- archive: 通知・ニュースレター・自動送信など、読み終わり/保存だけで良いもの
- keep: 人からの個別メール、要返信・要対応の可能性があるもの

判断に迷うものは必ず keep に倒す（誤って人のメールを片付けない）。
reason は指定された言語で簡潔に（日本語なら15文字以内、他言語も同等の短さ）。`;
