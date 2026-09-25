import type { Email } from "@/lib/types";

/**
 * Cheap, high-precision phishing/spam detection for the free (no-AI) layer.
 * Dangerous mail is a different axis from importance — a newsletter is "low" but
 * harmless; phishing is "low" AND must be warned about (don't click, don't enter
 * credentials). The AI refines this on open; this catches the obvious cases in
 * the list instantly and offline.
 *
 * Primary signal (low false-positive): brand/authority IMPERSONATION — the
 * display name claims a well-known org but the sender domain is not theirs
 * (e.g. 「国税庁」from password.jxsxbl.com). Plus a learned list of senders the
 * user has reported as spam.
 */
type ThreatInput = Pick<Email, "subject"> & {
  from: { name?: string; email: string };
};

/** Learned reports: senders/domains the user marked as 迷惑メール. */
export interface ThreatSenders {
  senders: Set<string>;
  domains: Set<string>;
}

// Commonly impersonated JP/global brands & authorities → their legit domains.
const IMPERSONATED: { kw: RegExp; domains: string[] }[] = [
  {
    kw: /国税庁|税務署|e-?tax|eltax/i,
    domains: ["nta.go.jp", "eltax.lta.go.jp"],
  },
  { kw: /日本年金|年金機構/, domains: ["nenkin.go.jp"] },
  { kw: /amazon|アマゾン/i, domains: ["amazon.co.jp", "amazon.com"] },
  { kw: /楽天|rakuten/i, domains: ["rakuten.co.jp", "rakuten.com"] },
  { kw: /三井住友|smbc/i, domains: ["smbc.co.jp", "smbcgroup.com"] },
  { kw: /三菱\s*ufj|mufg/i, domains: ["mufg.jp", "bk.mufg.jp"] },
  { kw: /みずほ|mizuho/i, domains: ["mizuhobank.co.jp", "mizuho-fg.co.jp"] },
  {
    kw: /ゆうちょ|japan\s*post|日本郵便/i,
    domains: ["jp-bank.japanpost.jp", "japanpost.jp"],
  },
  { kw: /paypay|ペイペイ/i, domains: ["paypay.ne.jp"] },
  { kw: /ヤマト運輸|クロネコ/i, domains: ["kuronekoyamato.co.jp"] },
  { kw: /佐川急便|sagawa/i, domains: ["sagawa-exp.co.jp"] },
  { kw: /apple|アップル/i, domains: ["apple.com", "icloud.com"] },
  {
    kw: /microsoft|マイクロソフト/i,
    domains: ["microsoft.com", "outlook.com"],
  },
  {
    kw: /\bgoogle\b|グーグル/i,
    domains: ["google.com", "accounts.google.com"],
  },
  {
    kw: /えきねっと|jr東日本|view\s*card/i,
    domains: ["eki-net.com", "jreast.co.jp"],
  },
  { kw: /etc利用照会|etc\s*サービス/i, domains: ["etc-meisai.jp"] },
];

/** Domain matches a legit domain exactly or as a subdomain. */
function domainMatches(domain: string, legit: string[]): boolean {
  return legit.some((d) => domain === d || domain.endsWith("." + d));
}

export function detectThreat(
  email: ThreatInput,
  learned?: ThreatSenders,
  safe?: ThreatSenders,
): "spam" | "phishing" | undefined {
  const name = email.from.name ?? "";
  const addr = email.from.email.toLowerCase();
  const domain = addr.split("@")[1] ?? "";
  const subject = email.subject ?? "";

  // 「問題無し」で安全登録された差出人は、学習・偽装ヒューリスティックより優先して
  // 危険と判定しない（誤検知の打ち消し）。
  if (safe && (safe.senders.has(addr) || safe.domains.has(domain))) {
    return undefined;
  }

  // User-reported spam sender/domain.
  if (learned && (learned.senders.has(addr) || learned.domains.has(domain))) {
    return "spam";
  }

  // Brand impersonation: name/subject claims a brand, sender domain isn't theirs.
  for (const b of IMPERSONATED) {
    if (b.kw.test(name) || b.kw.test(subject)) {
      if (!domainMatches(domain, b.domains)) return "phishing";
    }
  }
  return undefined;
}
