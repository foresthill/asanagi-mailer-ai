import type { OpenProjectSettings } from "@/lib/types";

/**
 * OpenProject REST API v3 client (Community Edition compatible).
 *
 * Auth is HTTP Basic with the literal username "apikey" and the user's API
 * token as the password — the documented way to use an API key:
 *   https://www.openproject.org/docs/api/#authentication
 *
 * local-first: the base URL + token live only in `.data` and are passed in per
 * call. Nothing here caches credentials or phones anywhere but the user's own
 * instance. Mail bodies only leave the device when the user explicitly presses
 * "send to OpenProject".
 */

export interface OpProject {
  id: number;
  name: string;
  identifier: string;
}

export interface OpCreatedWorkPackage {
  id: number;
  subject: string;
  /** Browser URL (…/work_packages/{id}), derived from the base URL. */
  url: string;
}

/** Normalize a base URL: trim, drop a trailing slash, require http(s). */
export function normalizeBaseUrl(raw?: string): string {
  const s = (raw ?? "").trim().replace(/\/+$/, "");
  return s;
}

function authHeader(apiKey: string): string {
  // "apikey:<token>" base64 — Buffer is fine (this only runs server-side).
  const token = Buffer.from(`apikey:${apiKey}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

/** A connection is usable only with both a base URL and a key. */
export function isOpConfigured(s: OpenProjectSettings): boolean {
  return !!normalizeBaseUrl(s.baseUrl) && !!s.apiKey?.trim();
}

class OpError extends Error {}

async function opFetch(
  baseUrl: string,
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const url = `${baseUrl}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: authHeader(apiKey),
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    clearTimeout(timer);
    const msg =
      e instanceof Error && e.name === "AbortError" ? "timeout" : "network";
    throw new OpError(
      msg === "timeout"
        ? "接続がタイムアウトしました。URL とネットワークを確認してください。"
        : "接続できませんでした。URL を確認してください。",
    );
  }
  clearTimeout(timer);

  if (res.status === 401 || res.status === 403) {
    throw new OpError("認証に失敗しました。API キーを確認してください。");
  }
  if (!res.ok) {
    // OpenProject returns { _type:"Error", message, _embedded:{ errors:[…] } }.
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) detail = body.message;
    } catch {
      /* keep the status */
    }
    throw new OpError(detail);
  }
  return res.json();
}

/** List projects the token can see (name + id), for the settings picker. */
export async function listProjects(
  baseUrl: string,
  apiKey: string,
): Promise<OpProject[]> {
  const data = (await opFetch(
    baseUrl,
    apiKey,
    "/api/v3/projects?pageSize=200&sortBy=%5B%5B%22name%22%2C%22asc%22%5D%5D",
  )) as { _embedded?: { elements?: Array<Record<string, unknown>> } };
  const els = data?._embedded?.elements ?? [];
  return els.map((e) => ({
    id: Number(e.id),
    name: String(e.name ?? ""),
    identifier: String(e.identifier ?? ""),
  }));
}

interface OpType {
  id: number;
  name: string;
  isMilestone: boolean;
}

/** Types available in a project; used to pick a valid type for creation. */
async function listProjectTypes(
  baseUrl: string,
  apiKey: string,
  projectId: string,
): Promise<OpType[]> {
  const data = (await opFetch(
    baseUrl,
    apiKey,
    `/api/v3/projects/${encodeURIComponent(projectId)}/types`,
  )) as { _embedded?: { elements?: Array<Record<string, unknown>> } };
  const els = data?._embedded?.elements ?? [];
  return els.map((e) => ({
    id: Number(e.id),
    name: String(e.name ?? ""),
    isMilestone: Boolean(e.isMilestone),
  }));
}

/** Pick a sensible default type: a Task-like non-milestone, else the first. */
function pickTypeId(types: OpType[]): number | undefined {
  if (types.length === 0) return undefined;
  const task = types.find((t) => /task|タスク|作業|feature|機能/i.test(t.name));
  if (task) return task.id;
  const nonMilestone = types.find((t) => !t.isMilestone);
  return (nonMilestone ?? types[0]).id;
}

/**
 * Create a work package in the configured project. Title = subject, body goes
 * into the description (markdown). Throws OpError with a Japanese message on
 * any failure so callers can surface it verbatim.
 */
export async function createWorkPackage(
  settings: OpenProjectSettings,
  input: { subject: string; description?: string },
): Promise<OpCreatedWorkPackage> {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const apiKey = settings.apiKey?.trim();
  const projectId = settings.projectId?.trim();
  if (!baseUrl || !apiKey) throw new OpError("OpenProject が未設定です。");
  if (!projectId) throw new OpError("送り先プロジェクトが未設定です。");

  const types = await listProjectTypes(baseUrl, apiKey, projectId);
  const typeId = pickTypeId(types);
  if (!typeId) {
    throw new OpError("このプロジェクトで使えるタイプが見つかりませんでした。");
  }

  const payload = {
    subject: input.subject.slice(0, 255) || "(無題)",
    description: { format: "markdown", raw: input.description ?? "" },
    _links: { type: { href: `/api/v3/types/${typeId}` } },
  };

  const created = (await opFetch(
    baseUrl,
    apiKey,
    `/api/v3/projects/${encodeURIComponent(projectId)}/work_packages`,
    { method: "POST", body: JSON.stringify(payload) },
  )) as { id?: number; subject?: string };

  const id = Number(created?.id);
  if (!id) throw new OpError("work package の作成結果が不正でした。");
  return {
    id,
    subject: String(created?.subject ?? payload.subject),
    url: `${baseUrl}/work_packages/${id}`,
  };
}
