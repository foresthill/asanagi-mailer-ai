import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { DevlogSettings, DevlogIssue } from "@/lib/types";

/**
 * devlog integration client.
 *
 * devlog exposes no token-authenticated plain REST API — its only auth-capable
 * programmatic surface is the MCP endpoint (`/api/mcp`, Streamable HTTP JSON-RPC)
 * with a `dvlg_` Bearer token minted in devlog's project settings. So Asanagi
 * talks to devlog as an MCP CLIENT, calling the tools list_projects /
 * create_issue / list_issues.
 *
 * local-first: the base URL + token live only in `.data` and are passed in per
 * call. Mail content leaves the device only when the user explicitly presses
 * "send to devlog" (the created issue goes to the user's own devlog instance).
 */

export interface DevlogProject {
  key: string;
  name: string;
}

export interface DevlogCreatedIssue {
  issueKey: string;
  projectKey: string;
  url: string;
}

export function normalizeBaseUrl(raw?: string): string {
  return (raw ?? "").trim().replace(/\/+$/, "");
}

export function isDevlogConfigured(s: DevlogSettings): boolean {
  return !!normalizeBaseUrl(s.baseUrl) && !!s.token?.trim();
}

class DevlogError extends Error {}

/** Open an MCP client to devlog, run one tool call, and always close it. */
async function callTool(
  baseUrl: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/api/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const client = new Client(
    { name: "asanagi", version: "1.0.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
  } catch {
    await transport.close().catch(() => {});
    throw new DevlogError(
      "devlog に接続できませんでした。URL とトークンを確認してください。",
    );
  }
  try {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      structuredContent?: unknown;
      content?: Array<{ type: string; text?: string }>;
    };
    if (res.isError) {
      const msg =
        res.content?.find((c) => c.type === "text")?.text ??
        "devlog の操作に失敗しました。";
      throw new DevlogError(msg);
    }
    // devlog tools return their JSON payload as text content; prefer the
    // structured form when present, else parse the first text block.
    if (res.structuredContent && typeof res.structuredContent === "object") {
      return res.structuredContent;
    }
    const text = res.content?.find((c) => c.type === "text")?.text;
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  } catch (e) {
    if (e instanceof DevlogError) throw e;
    throw new DevlogError(
      e instanceof Error ? e.message : "devlog の操作に失敗しました。",
    );
  } finally {
    await client.close().catch(() => {});
  }
}

/** List projects the token can see (key + name), for the settings picker. */
export async function listProjects(
  baseUrl: string,
  token: string,
): Promise<DevlogProject[]> {
  const data = (await callTool(baseUrl, token, "list_projects", {})) as {
    projects?: Array<{ key?: string; name?: string }>;
  };
  return (data.projects ?? []).map((p) => ({
    key: String(p.key ?? ""),
    name: String(p.name ?? p.key ?? ""),
  }));
}

/** Create an issue in the configured project. Title = subject, body = description. */
export async function createIssue(
  settings: DevlogSettings,
  input: { title: string; description?: string },
): Promise<DevlogCreatedIssue> {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const token = settings.token?.trim();
  const projectKey = settings.projectKey?.trim();
  if (!baseUrl || !token) throw new DevlogError("devlog が未設定です。");
  if (!projectKey) throw new DevlogError("送り先プロジェクトが未設定です。");

  const data = (await callTool(baseUrl, token, "create_issue", {
    projectKey,
    title: input.title.slice(0, 255) || "(無題)",
    description: input.description ?? "",
  })) as { issueKey?: string; projectKey?: string };

  const issueKey = String(data.issueKey ?? "");
  const pKey = String(data.projectKey ?? projectKey);
  if (!issueKey) throw new DevlogError("issue の作成結果が不正でした。");
  return {
    issueKey,
    projectKey: pKey,
    url: `${baseUrl}/projects/${pKey}/issues/${issueKey}`,
  };
}

/**
 * Read-only pull: open issues in the configured project (newest first). devlog's
 * MCP has no "assigned to me" primitive, so this shows the project's open issues.
 */
export async function listOpenIssues(
  settings: DevlogSettings,
): Promise<DevlogIssue[]> {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const token = settings.token?.trim();
  const projectKey = settings.projectKey?.trim();
  if (!baseUrl || !token) throw new DevlogError("devlog が未設定です。");
  if (!projectKey) throw new DevlogError("送り先プロジェクトが未設定です。");

  const data = (await callTool(baseUrl, token, "list_issues", {
    projectKey,
    state: "open",
    limit: 50,
  })) as {
    issues?: Array<Record<string, unknown>>;
  };
  return (data.issues ?? []).map((i) => {
    const key = String(i.key ?? "");
    return {
      key,
      title: String(i.title ?? ""),
      status: typeof i.status === "string" ? i.status : undefined,
      priority: typeof i.priority === "string" ? i.priority : undefined,
      dueDate: typeof i.dueDate === "string" ? i.dueDate : undefined,
      url: `${baseUrl}/projects/${projectKey}/issues/${key}`,
    };
  });
}
