import type { EmailAddress, MeetingInvite } from "@/lib/types";

/**
 * Dependency-free mini iCalendar (RFC 5545) parser for meeting invites —
 * VEVENT essentials only (SUMMARY/DTSTART/DTEND/LOCATION/ORGANIZER/UID/
 * METHOD). RRULE recurrence is out of scope for now (docs/05 §2.3): the
 * card shows the first occurrence and flags it as 定期.
 */

/** Unfold RFC 5545 §3.1 long lines (CRLF followed by space/tab). */
function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

/** "DTSTART;TZID=Asia/Tokyo:20260622T170000" → ISO 8601 string. */
function parseIcsDate(params: Record<string, string>, value: string): string | undefined {
  // All-day form: VALUE=DATE / bare YYYYMMDD.
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (params.VALUE === "DATE" || dateOnly) {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z === "Z") return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const tzid = params.TZID;
  if (tzid) {
    // Resolve the wall-clock time in TZID to a UTC instant via Intl —
    // covers IANA zones without a timezone database dependency.
    try {
      const utcGuess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tzid,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const parts = Object.fromEntries(fmt.formatToParts(utcGuess).map((p) => [p.type, p.value]));
      const asIfUtc = Date.UTC(
        +parts.year,
        +parts.month - 1,
        +parts.day,
        +(parts.hour === "24" ? 0 : parts.hour),
        +parts.minute,
        +parts.second,
      );
      return new Date(utcGuess - (asIfUtc - utcGuess)).toISOString();
    } catch {
      /* unknown TZID — fall through to floating time */
    }
  }
  // Floating time: interpret in the local zone of this machine.
  return new Date(+y, +mo - 1, +d, +h, +mi, +s).toISOString();
}

function parseOrganizer(params: Record<string, string>, value: string): EmailAddress {
  const email = value.replace(/^mailto:/i, "").trim();
  return { name: params.CN || undefined, email };
}

/** Unescape RFC 5545 TEXT values (\n \, \; \\). */
function unescapeText(s: string): string {
  return s
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
}

const JOIN_URL_RE =
  /https:\/\/(?:teams\.microsoft\.com\/l\/meetup-join|teams\.live\.com\/meet|meet\.google\.com|[\w.-]*zoom\.us\/j)\/[^\s<>"'）)】」]*/i;

/** Teams/Meet/Zoom join URL inside any text (ICS description or mail body). */
export function detectJoinUrl(text: string): string | undefined {
  return JOIN_URL_RE.exec(text)?.[0];
}

/** Parse the first VEVENT of an iCalendar document. Null when none. */
export function parseIcs(ics: string): MeetingInvite | null {
  const lines = unfold(ics);
  let method: string | undefined;
  let inEvent = false;
  const invite: MeetingInvite = {};
  let description = "";

  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = left.split(";");
    const params: Record<string, string> = {};
    for (const p of paramParts) {
      const eq = p.indexOf("=");
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    const key = name.toUpperCase();

    if (key === "METHOD") method = value.trim();
    if (key === "BEGIN" && value.trim() === "VEVENT") inEvent = true;
    if (key === "END" && value.trim() === "VEVENT") break; // first VEVENT only
    if (!inEvent) continue;

    switch (key) {
      case "UID":
        invite.uid = value.trim();
        break;
      case "SUMMARY":
        invite.summary = unescapeText(value);
        break;
      case "LOCATION":
        invite.location = unescapeText(value);
        break;
      case "DESCRIPTION":
        description = unescapeText(value);
        break;
      case "DTSTART":
        invite.start = parseIcsDate(params, value.trim());
        invite.allDay = params.VALUE === "DATE" || /^\d{8}$/.test(value.trim());
        break;
      case "DTEND":
        invite.end = parseIcsDate(params, value.trim());
        break;
      case "ORGANIZER":
        invite.organizer = parseOrganizer(params, value);
        break;
      case "RRULE":
        invite.recurring = true;
        break;
    }
  }

  if (!invite.uid && !invite.summary && !invite.start) return null;
  invite.method = method;
  invite.joinUrl =
    detectJoinUrl(description) ??
    (invite.location ? detectJoinUrl(invite.location) : undefined);
  return invite;
}
