import type { NextcloudSettings, NextcloudCalendar } from "@/lib/types";

/**
 * Nextcloud CalDAV client (create calendar events; list calendars).
 *
 * Auth is HTTP Basic with the username + an app-password (Settings → Security →
 * Devices & sessions → Create new app password). CalDAV lives under
 * `${baseUrl}/remote.php/dav/calendars/{user}/`. Listing calendars is a PROPFIND;
 * creating an event is a PUT of an iCalendar VEVENT to `{calendar}/{uid}.ics`.
 *
 * local-first: the URL + app-password live only in `.data` and are passed in per
 * call. A TODO's details leave the device only when the user presses "add to
 * calendar" (the event goes to the user's own Nextcloud).
 */

export function normalizeBaseUrl(raw?: string): string {
  return (raw ?? "").trim().replace(/\/+$/, "");
}

export function isNextcloudConfigured(s: NextcloudSettings): boolean {
  return (
    !!normalizeBaseUrl(s.baseUrl) &&
    !!s.username?.trim() &&
    !!s.appPassword?.trim()
  );
}

function authHeader(username: string, appPassword: string): string {
  const b = Buffer.from(`${username}:${appPassword}`, "utf8").toString(
    "base64",
  );
  return `Basic ${b}`;
}

class NcError extends Error {}

async function davFetch(
  url: string,
  auth: string,
  init: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { Authorization: auth, ...(init.headers ?? {}) },
    });
  } catch (e) {
    clearTimeout(timer);
    const timeout = e instanceof Error && e.name === "AbortError";
    throw new NcError(
      timeout
        ? "接続がタイムアウトしました。URL とネットワークを確認してください。"
        : "接続できませんでした。URL を確認してください。",
    );
  }
  clearTimeout(timer);
  if (res.status === 401 || res.status === 403) {
    throw new NcError(
      "認証に失敗しました。ユーザー名とアプリパスワードを確認してください。",
    );
  }
  return res;
}

/**
 * List the user's calendars via PROPFIND (Depth 1) on their calendar home.
 * Returns only writable calendar collections (skips the home node and subscriptions).
 */
export async function listCalendars(
  baseUrl: string,
  username: string,
  appPassword: string,
): Promise<NextcloudCalendar[]> {
  const origin = new URL(baseUrl).origin;
  const home = `${baseUrl}/remote.php/dav/calendars/${encodeURIComponent(username)}/`;
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <cal:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`;
  const res = await davFetch(home, authHeader(username, appPassword), {
    method: "PROPFIND",
    headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
    body,
  });
  if (!res.ok)
    throw new NcError(
      `カレンダー一覧を取得できませんでした（HTTP ${res.status}）。`,
    );
  const xml = await res.text();

  // Split into <response> blocks (namespace prefix varies: d:/D:). Regex parse is
  // adequate for Nextcloud's stable PROPFIND output (no XML dep pulled in).
  const blocks = xml.split(/<\/[a-zA-Z]*:?response>/).slice(0, -1);
  const out: NextcloudCalendar[] = [];
  for (const b of blocks) {
    const href = b.match(/<[a-zA-Z]*:?href>([^<]+)<\/[a-zA-Z]*:?href>/)?.[1];
    if (!href) continue;
    // Only calendar collections that support VEVENT.
    const isCalendar = /<[a-zA-Z]*:?calendar\b/.test(b);
    const supportsEvents =
      !/supported-calendar-component-set/.test(b) ||
      /comp\b[^>]*name="VEVENT"/i.test(b);
    if (!isCalendar || !supportsEvents) continue;
    const name =
      b
        .match(/<[a-zA-Z]*:?displayname>([^<]*)<\/[a-zA-Z]*:?displayname>/)?.[1]
        ?.trim() ||
      decodeURIComponent(href.replace(/\/+$/, "").split("/").pop() ?? "");
    if (!name) continue;
    const url = href.startsWith("http") ? href : `${origin}${href}`;
    out.push({ url, name });
  }
  return out;
}

/** Escape a text value for an iCalendar property (RFC 5545). */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** UTC timestamp YYYYMMDDTHHMMSSZ. */
function icsUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * Create a timed calendar event (default 30 min) from a due time. Returns the
 * event UID. Idempotent-ish: pass a stable `uid` to overwrite the same event.
 */
export async function createEvent(
  settings: NextcloudSettings,
  input: { title: string; description?: string; start: string; uid?: string },
): Promise<{ uid: string }> {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const { username, appPassword, calendarUrl } = settings;
  if (!baseUrl || !username?.trim() || !appPassword?.trim())
    throw new NcError("Nextcloud が未設定です。");
  if (!calendarUrl) throw new NcError("対象カレンダーが未設定です。");

  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) throw new NcError("開始日時が不正です。");
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const uid = input.uid ?? `asanagi-${crypto.randomUUID()}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Asanagi//Asanagi//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsEscape(input.title || "(無題)")}`,
    ...(input.description
      ? [`DESCRIPTION:${icsEscape(input.description)}`]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const ics = lines.join("\r\n");

  const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  const res = await davFetch(
    `${base}${uid}.ics`,
    authHeader(username, appPassword),
    {
      method: "PUT",
      headers: { "Content-Type": "text/calendar; charset=utf-8" },
      body: ics,
    },
  );
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    throw new NcError(`予定を登録できませんでした（HTTP ${res.status}）。`);
  }
  return { uid };
}
