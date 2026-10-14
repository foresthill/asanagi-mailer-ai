/**
 * サーバ起動時フック（Next.js instrumentation）。
 *
 * Linux で IMAP/SMTP 等の外向き接続が `ETIMEDOUT`/`ENETUNREACH` になる定番原因が
 * 「Node が名前解決で IPv6(AAAA) を先に試し、実機/ネットワークの IPv6 経路が壊れて
 * いる/塞がれている」こと。macOS では問題なく、Linux デスクトップだけ繋がらない、
 * という症状になりやすい。既定の解決順を IPv4 優先にして回避する（IPv4 を持つ通常の
 * メールサーバには無害）。Node ランタイムのときだけ適用。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const dns = await import("node:dns");
      dns.setDefaultResultOrder("ipv4first");
    } catch {
      /* 失敗しても致命的ではない（従来どおりの解決順にフォールバック） */
    }
  }
}
