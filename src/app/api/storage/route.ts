import { NextResponse } from "next/server";
import { storageStats, RETENTION_PER_ACCOUNT } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Local cache usage for the Gmail-style storage meter in the sidebar. */
export async function GET() {
  const stats = storageStats();
  return NextResponse.json({
    ...stats,
    retentionPerAccount: RETENTION_PER_ACCOUNT,
  });
}
