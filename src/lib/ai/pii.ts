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

  /** Replace structured PII in `text` with reversible tokens. */
  mask(text: string): string {
    if (!text) return text;
    let out = text;
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

  /** Masked copy of an email for AI prompts. The display NAME is kept (needed
   *  for greeting/宛名 quality), but From/To/Cc/Bcc email ADDRESSES are masked
   *  (the domain identifies the company = confidential) along with subject,
   *  snippet and body. Same address → same token as its occurrences in the body. */
  maskEmail(email: Email): Email {
    const addr = <T extends EmailAddress>(a: T): T => ({ ...a, email: this.mask(a.email) });
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
