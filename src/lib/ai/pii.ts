import type { Email, EmailAddress } from "@/lib/types";

/**
 * Phase A PII masking (docs/00 Phase 2 の前倒し): 構造化PIIを正規表現で
 * ローカル検出し、可逆トークン（[EMAIL_1] 等）に置換してからAIへ送る。
 * AI出力中のトークンは端末側で原文に戻すため、返信品質をほぼ損なわない。
 *
 * 完全ローカル・依存ゼロ。人名・住所など非構造PIIはNERが必要で対象外
 * （Phase B: cameltech/japanese-gpt-1b-PII-masking 等のローカルNER検討）。
 * 誤検出は「余計に隠す」方向に倒す（over-masking は安全側）。
 */

interface Pattern {
  label: string;
  re: RegExp;
  /** Extra validation on the raw match (e.g. Luhn for card numbers). */
  accept?: (raw: string) => boolean;
}

/** Luhn checksum — distinguishes card numbers from arbitrary digit runs. */
function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Order matters: longer/stricter shapes first so e.g. card numbers aren't
// half-eaten by the phone pattern.
const PATTERNS: Pattern[] = [
  {
    label: "EMAIL",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    label: "CARD",
    re: /(?<!\d)(?:\d[ -]?){12,15}\d(?!\d)/g,
    accept: (raw) => {
      const d = raw.replace(/\D/g, "");
      return d.length >= 13 && d.length <= 16 && luhn(d);
    },
  },
  {
    // マイナンバー等の12桁連番（カードでLuhn不一致だったものも含む）。
    label: "NUMBER12",
    re: /(?<!\d)\d{12}(?!\d)/g,
  },
  {
    // 固定・携帯・フリーダイヤル（0始まり10〜11桁、区切りあり/なし）＋ +81。
    label: "PHONE",
    re: /(?<!\d)(?:\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}|0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})(?!\d)/g,
    accept: (raw) => {
      const d = raw.replace(/\D/g, "");
      return d.length >= 10 && d.length <= 12;
    },
  },
  {
    label: "POSTAL",
    re: /(?<!\d)\d{3}-\d{4}(?!\d)/g,
  },
];

export class PiiMasker {
  /** token → original (for unmasking AI output). */
  private map = new Map<string, string>();
  /** original → token (same value always gets the same token). */
  private seen = new Map<string, string>();
  private counters = new Map<string, number>();
  /** NER-detected names/orgs to dictionary-replace (longest-first). */
  private entities: string[] = [];

  /**
   * Learn person/company names from `texts` via local NER (opt-in) and register
   * them as reversible tokens, so a subsequent mask()/maskEmail() also hides
   * them. Dynamic import keeps the ML runtime out of the path unless enabled.
   * Best-effort: NER failure must never block an AI call (structured PII is
   * still masked by regex), so errors are swallowed.
   */
  async learnEntities(texts: (string | undefined)[]): Promise<void> {
    const joined = texts.filter(Boolean).join("\n").trim();
    if (!joined) return;
    try {
      const { detectEntities } = await import("./ner");
      for (const e of await detectEntities(joined)) {
        this.registerEntity(e.text, e.type === "ORG" ? "ORG" : "NAME");
      }
    } catch (err) {
      console.warn("[pii] NER masking skipped:", err instanceof Error ? err.message : err);
    }
  }

  /** Force-mask a specific personal/company name and return its token. Used for
   *  the reply perspective guard so the principal names (writer + counterparty)
   *  are tokenized consistently with the body — otherwise they'd leak in plain
   *  text. Idempotent; registering here also masks the name in body/name fields
   *  via mask(). No-op (returns the input) for empty names. */
  maskName(name: string | undefined): string | undefined {
    if (!name?.trim()) return name;
    this.registerEntity(name.trim(), "NAME");
    return this.mask(name);
  }

  /** Register one arbitrary surface string (a NER name/org) as a token. */
  private registerEntity(surface: string, label: "NAME" | "ORG"): void {
    const s = surface.trim();
    if (s.length < 2 || this.seen.has(s)) return;
    const n = (this.counters.get(label) ?? 0) + 1;
    this.counters.set(label, n);
    const token = `[${label}_${n}]`;
    this.map.set(token, s);
    this.seen.set(s, token);
    // Keep longest-first so a longer name masks before its substrings.
    this.entities.push(s);
    this.entities.sort((a, b) => b.length - a.length);
  }

  /** Replace structured PII (+ any learned names/orgs) in `text` with tokens. */
  mask(text: string): string {
    if (!text) return text;
    let out = text;
    // Dictionary pass first: NER-learned names/orgs are arbitrary strings the
    // regex patterns can't match. Longest-first (see registerEntity).
    for (const key of this.entities) {
      const token = this.seen.get(key);
      if (token) out = out.split(key).join(token);
    }
    for (const p of PATTERNS) {
      out = out.replace(p.re, (raw) => {
        if (p.accept && !p.accept(raw)) return raw;
        const cached = this.seen.get(raw);
        if (cached) return cached;
        const n = (this.counters.get(p.label) ?? 0) + 1;
        this.counters.set(p.label, n);
        const token = `[${p.label}_${n}]`;
        this.map.set(token, raw);
        this.seen.set(raw, token);
        return token;
      });
    }
    return out;
  }

  /** Restore every token in AI output back to the original value. */
  unmask(text: string): string {
    if (!text || this.map.size === 0) return text;
    let out = text;
    for (const [token, original] of this.map) {
      out = out.split(token).join(original);
    }
    return out;
  }

  /** How many distinct PII values were masked (for logging/debugging). */
  get count(): number {
    return this.map.size;
  }

  /** Distinct masked values per type, e.g. { EMAIL: 5, PHONE: 2, DOMAIN: 3 }. */
  stats(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  /**
   * Count structured PII STILL present in already-masked text — i.e. a leak: a
   * value the masker missed, or (more often) text on a path that bypassed
   * masking (user-authored guidance/メモ, headers we don't mask). Masked tokens
   * like `[EMAIL_1]` don't match the patterns, so any hit is a real residual.
   * NOTE: names/addresses are NOT detected here (regex only) — that gap needs
   * NER (e.g. GiNZA). So residual=0 means "no structured PII slipped", NOT
   * "fully anonymized".
   */
  residualPii(text: string): number {
    if (!text) return 0;
    let n = 0;
    for (const p of PATTERNS) {
      for (const m of text.matchAll(p.re)) {
        if (!p.accept || p.accept(m[0])) n++;
      }
    }
    return n;
  }

  /** Masking audit for one outgoing prompt: what was masked + what leaked. */
  audit(outgoingText: string): { masked: Record<string, number>; total: number; residual: number } {
    return { masked: this.stats(), total: this.count, residual: this.residualPii(outgoingText) };
  }

  /** Reversibly tokenize a bare domain (no `@`, so the email regex misses it)
   *  as `[DOMAIN_n]`. Same domain → same token (shared seen/map). Used for the
   *  learned-signal block so company domains don't leak to the AI provider. */
  maskDomain(domain: string): string {
    if (!domain) return domain;
    const cached = this.seen.get(domain);
    if (cached) return cached;
    const n = (this.counters.get("DOMAIN") ?? 0) + 1;
    this.counters.set("DOMAIN", n);
    const token = `[DOMAIN_${n}]`;
    this.map.set(token, domain);
    this.seen.set(domain, token);
    return token;
  }

  /** Masked copy of an email for AI prompts. From/To/Cc/Bcc email ADDRESSES are
   *  masked (the domain identifies the company = confidential) along with
   *  subject, snippet and body. Display NAMES pass through mask() too: without
   *  NER learning they're unchanged (kept for greeting/宛名 quality); with NER
   *  on, a learned person/company name gets the same token as in the body. */
  maskEmail(email: Email): Email {
    const addr = <T extends EmailAddress>(a: T): T => ({
      ...a,
      name: a.name ? this.mask(a.name) : a.name,
      email: this.mask(a.email),
    });
    return {
      ...email,
      from: addr(email.from),
      to: email.to.map(addr),
      cc: email.cc?.map(addr),
      bcc: email.bcc?.map(addr),
      subject: this.mask(email.subject),
      snippet: this.mask(email.snippet),
      body: this.mask(email.body),
    };
  }
}

/**
 * Audit one AI call's masking: returns a JSON string {masked,total,residual}
 * for the AI log, and warns to the server log if any structured PII leaked
 * (residual > 0) so it isn't silently swallowed. Call with the exact text that
 * left the device (system + prompt).
 */
export function auditOutgoing(kind: string, masker: PiiMasker, outgoingText: string): string {
  const a = masker.audit(outgoingText);
  if (a.residual > 0) {
    console.warn(
      `[pii] ${kind}: ${a.residual} unmasked structured PII item(s) in the outgoing prompt (masked ${a.total}). Check the masking path.`,
    );
  }
  return JSON.stringify(a);
}
