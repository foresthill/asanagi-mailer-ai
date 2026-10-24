import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * メール本文の画像をアプリ経由で取得する（クロスオリジンをまたいでクリップボード
 * へコピー／ファイルへ保存できるように）。iframe は直接リモート画像を読むが、
 * JS からバイト列を得るには CORS を越えられず、ブラウザ/WebView の右クリックも
 * 当てにならないため、ここでサーバ側が取得して同一オリジンで返す。
 *
 * ユーザーが本文で「画像を表示」した上で明示的に［コピー］［保存］を押したときだけ
 * 呼ばれる（自動では叩かない）。SSRF 対策として http/https・画像のみ・サイズ上限・
 * 内部アドレス遮断を行う。
 */
const MAX_BYTES = 25 * 1024 * 1024; // 25MB
const PRIVATE_HOST =
  /^(localhost|127\.|0\.0\.0\.0|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?fe80:|\[?fc|\[?fd)/i;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "url が必要です" }, { status: 400 });
  }
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "URL が不正です" }, { status: 400 });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "http/https のみ" }, { status: 400 });
  }
  if (PRIVATE_HOST.test(target.hostname)) {
    return NextResponse.json({ error: "内部アドレスは取得しません" }, { status: 400 });
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(target.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { accept: "image/*" },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      return NextResponse.json(
        { error: `取得失敗 (HTTP ${res.status})` },
        { status: 502 },
      );
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      return NextResponse.json({ error: "画像ではありません" }, { status: 415 });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "画像が大きすぎます" }, { status: 413 });
    }
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "取得に失敗しました" },
      { status: 502 },
    );
  }
}
