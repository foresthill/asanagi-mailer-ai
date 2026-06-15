import { NextResponse } from "next/server";
import { addSweptIds, getSweptIds } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 判断済みメールIDの集合（朝の一掃の再提示除外用）。 */
export async function GET() {
  return NextResponse.json({ ids: [...(await getSweptIds())] });
}

/** 確定: これらのメールは「さばき済み」として今後の一掃から除外する。 */
export async function POST(req: Request) {
  const { ids } = (await req.json()) as { ids: string[] };
  await addSweptIds(Array.isArray(ids) ? ids.filter(Boolean) : []);
  return NextResponse.json({ ok: true });
}
