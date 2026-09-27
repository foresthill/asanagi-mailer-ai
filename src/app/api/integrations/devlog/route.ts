import { NextResponse } from "next/server";
import { getDevlogSettings, saveDevlogSettings } from "@/lib/store";
import {
  isDevlogConfigured,
  normalizeBaseUrl,
} from "@/lib/integrations/devlog";
import type { DevlogSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Never return the raw token — only whether it's set and its last 4 chars. */
function maskToken(token?: string): { set: boolean; last4?: string } {
  if (!token?.trim()) return { set: false };
  return { set: true, last4: token.trim().slice(-4) };
}

async function safeView() {
  const s = await getDevlogSettings();
  return {
    baseUrl: normalizeBaseUrl(s.baseUrl),
    projectKey: s.projectKey ?? "",
    projectName: s.projectName ?? "",
    token: maskToken(s.token),
    configured: isDevlogConfigured(s),
  };
}

export async function GET() {
  return NextResponse.json(await safeView());
}

export async function POST(req: Request) {
  let body: DevlogSettings;
  try {
    body = (await req.json()) as DevlogSettings;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const patch: DevlogSettings = {};
  if (typeof body.baseUrl === "string") patch.baseUrl = body.baseUrl;
  if (typeof body.token === "string") patch.token = body.token; // "" clears
  if (typeof body.projectKey === "string") patch.projectKey = body.projectKey;
  if (typeof body.projectName === "string")
    patch.projectName = body.projectName;

  await saveDevlogSettings(patch);
  return NextResponse.json({ ok: true, ...(await safeView()) });
}
