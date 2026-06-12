import { NextResponse } from "next/server";
import { aiUsageStats } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Local AI usage log (cost transparency): tokens in/out, per model/feature. */
export async function GET() {
  return NextResponse.json(aiUsageStats());
}
