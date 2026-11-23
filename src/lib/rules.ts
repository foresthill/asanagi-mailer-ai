import type {
  ContactColor,
  Email,
  MailRule,
  RuleCondition,
} from "@/lib/types";

/**
 * Mail rule evaluation (Mac Mail-style Rules). Pure, synchronous, and cheap
 * (simple string matches) so the list can evaluate every row on render — rules
 * reflect live, with no persisted per-message state and no backfill. v1 only
 * resolves a row color; the sender's ContactMeta color is the fallback when no
 * rule matches (precedence lives in the caller: rule match > contact color).
 */

function matchCondition(e: Email, c: RuleCondition): boolean {
  switch (c.field) {
    case "from": {
      const addr = e.from.email.toLowerCase();
      const v = (c.value ?? "").trim().toLowerCase();
      if (!v) return false;
      if (c.op === "equals") return addr === v;
      if (c.op === "domainIs") {
        // Accept "twilio.com" or "@twilio.com" — match the address domain part.
        const domain = v.replace(/^@/, "");
        return addr.endsWith("@" + domain);
      }
      return addr.includes(v); // contains (default)
    }
    case "subject": {
      const v = (c.value ?? "").trim().toLowerCase();
      return v ? e.subject.toLowerCase().includes(v) : false;
    }
    case "recipient": {
      const v = (c.value ?? "").trim().toLowerCase();
      if (!v) return false;
      const all = [...(e.to ?? []), ...(e.cc ?? [])];
      return all.some((a) => a.email.toLowerCase().includes(v));
    }
    case "hasAttachment": {
      const has = (e.attachments?.length ?? 0) > 0;
      // value "no" = require NO attachment; anything else ("yes"/undefined) = has one.
      return c.value === "no" ? !has : has;
    }
    default:
      return false;
  }
}

/** Does this rule match the email? Disabled or condition-less rules never match. */
export function ruleMatches(e: Email, r: MailRule): boolean {
  if (!r.enabled) return false;
  if (r.conditions.length === 0) return false;
  return r.match === "all"
    ? r.conditions.every((c) => matchCondition(e, c))
    : r.conditions.some((c) => matchCondition(e, c));
}

/**
 * First-match-wins color across rules. `rules` must be ordered by priority
 * (top = highest = evaluated first); the list layer keeps them sorted by
 * `order`. Returns undefined when no enabled rule with a color action matches,
 * so the caller can fall back to the sender's ContactMeta color.
 */
export function resolveRuleColor(
  e: Email,
  rules: MailRule[],
): ContactColor | undefined {
  for (const r of rules) {
    if (ruleMatches(e, r)) {
      const color = r.actions.find((a) => a.type === "color")?.color;
      if (color) return color;
    }
  }
  return undefined;
}
