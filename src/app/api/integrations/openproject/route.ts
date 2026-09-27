import { NextResponse } from "next/server";
import { getOpenProjectSettings, saveOpenProjectSettings } from "@/lib/store";
import {
  isOpConfigured,
  normalizeBaseUrl,
} from "@/lib/integrations/openproject";
import type { OpenProjectSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Never return the raw key — only whether it's set and its last 4 chars. */
function maskKey(key?: string): { set: boolean; last4?: string } {
  if (!key?.trim()) return { set: false };
  return { set: true, last4: key.trim().slice(-4) };
}

async function safeView() {
  const s = await getOpenProjectSettings();
  return {
    baseUrl: normalizeBaseUrl(s.baseUrl),
    projectId: s.projectId ?? "",
    projectName: s.projectName ?? "",
    apiKey: maskKey(s.apiKey),
    configured: isOpConfigured(s),
  };
}

export async function GET() {
  return NextResponse.json(await safeView());
}

export async function POST(req: Request) {
  let body: OpenProjectSettings;
  try {
    body = (await req.json()) as OpenProjectSettings;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const patch: OpenProjectSettings = {};
  if (typeof body.baseUrl === "string") patch.baseUrl = body.baseUrl;
  if (typeof body.apiKey === "string") patch.apiKey = body.apiKey; // "" clears
  if (typeof body.projectId === "string") patch.projectId = body.projectId;
  if (typeof body.projectName === "string")
    patch.projectName = body.projectName;

  await saveOpenProjectSettings(patch);
  return NextResponse.json({ ok: true, ...(await safeView()) });
}
