import { getProvider } from "@/lib/email";
import { getProviderFor } from "@/lib/email/accounts";
import type { EmailProvider } from "@/lib/email";

export const maxDuration = 30;

/**
 * Stream one attachment on demand: GET /api/emails/{account}/{id}/attachment/{attId}
 * Bytes are fetched from the provider per request and never cached locally
 * (local-first: 添付は端末に溜めない). Returns it as a download.
 */
async function resolve(raw: string): Promise<{ provider: EmailProvider; id: string }> {
  const decoded = decodeURIComponent(raw);
  const slash = decoded.indexOf("/");
  if (slash > 0) {
    return { provider: await getProviderFor(decoded.slice(0, slash)), id: decoded.slice(slash + 1) };
  }
  return { provider: await getProvider(), id: decoded };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; attId: string }> },
) {
  const { id: rawId, attId } = await ctx.params;
  const { provider, id } = await resolve(rawId);
  if (!provider.getAttachment) {
    return new Response("このアカウントは添付ダウンロードに未対応です", { status: 400 });
  }
  const att = await provider.getAttachment(id, decodeURIComponent(attId));
  if (!att) return new Response("添付が見つかりません", { status: 404 });

  // RFC 5987 filename* so Japanese names download correctly.
  const encoded = encodeURIComponent(att.filename);
  return new Response(new Uint8Array(att.content), {
    headers: {
      "content-type": att.mimeType,
      "content-disposition": `attachment; filename*=UTF-8''${encoded}`,
      "content-length": String(att.content.length),
    },
  });
}
