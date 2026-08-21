/**
 * Turn a low-level send/connection error into a message a person can act on.
 * The providers (nodemailer SMTP / Gmail API / IMAP) surface raw errors like
 * "write ERANGE", "ECONNREFUSED", "535 auth failed" — useless to the user. This
 * maps the common ones to Japanese guidance and flags OAuth expiry for the
 * reauth prompt. Unknown errors keep a short technical tail (in parens) so
 * support can still diagnose.
 */
export function friendlyEmailError(err: unknown): { message: string; needsReauth: boolean } {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.toLowerCase();

  // OAuth token expiry (Gmail test-mode refresh token = 7 days) → reauth.
  if (/invalid_grant|token.*(expired|revoked)|\brevoked\b/.test(m)) {
    return {
      message: "認証が切れているため送信できませんでした（接続設定から再認証してください）",
      needsReauth: true,
    };
  }
  // Definitely a size limit (SMTP 552/523 or EMSGSIZE). The server's limit can be
  // lower than the app's 20MB cap, and base64 inflates the wire size ~33%.
  if (/emsgsize|message.*too\s*(big|large)|size\s*(limit|exceed)|\b552\b|\b523\b/.test(m)) {
    return {
      message:
        "メールが大きすぎて送信できませんでした。添付ファイルを小さくするか、分割して送ってください（送信先サーバの上限がアプリの上限より低い場合があります）。",
      needsReauth: false,
    };
  }
  // Socket-level write failure mid-send (ERANGE/EPIPE/reset/"write after end").
  // Ambiguous — could be a transient drop, a fussy server, or an oversized
  // payload — so we suggest retry AND the two likely fixes, without over-claiming.
  if (/erange|epipe|econnreset|write after end|socket.*(closed|hang)|premature/.test(m)) {
    return {
      message:
        "送信中に接続が切れました（write ERANGE 等）。もう一度お試しください。解消しない場合は、添付ファイルを小さくするか、ネットワーク（テザリング等）をご確認ください。",
      needsReauth: false,
    };
  }
  // SMTP auth (username / app password wrong).
  if (/\beauth\b|\b535\b|authentication\s*failed|invalid\s*login|username and password/.test(m)) {
    return {
      message:
        "メールサーバの認証に失敗しました。ユーザー名・パスワード（アプリパスワード）をご確認ください。",
      needsReauth: false,
    };
  }
  // Can't reach the server / network.
  if (/econnrefused|etimedout|enotfound|econnreset|ehostunreach|epipe|network|socket\s*(hang|close)|connection.*(refused|closed|timeout)/.test(m)) {
    return {
      message:
        "メールサーバに接続できませんでした。ネットワーク（VPN／テザリング等）とSMTP設定をご確認ください。",
      needsReauth: false,
    };
  }
  // TLS / port mismatch.
  if (/\btls\b|\bssl\b|certificate|wrong version|handshake|self.signed/.test(m)) {
    return {
      message:
        "暗号化接続（TLS/SSL）でエラーが発生しました。ポート（465／587）とSSL設定をご確認ください。",
      needsReauth: false,
    };
  }
  // Recipient rejected by the server.
  if (/\b5(50|51|53)\b|relay\s*(denied|access)|recipient|mailbox.*unavailable|no such user/.test(m)) {
    return {
      message: "宛先がサーバに拒否されました。宛先アドレスが正しいかご確認ください。",
      needsReauth: false,
    };
  }
  // Fallback — friendly lead, short technical tail for diagnosis.
  return {
    message: `送信に失敗しました（詳細: ${raw.slice(0, 140)}）`,
    needsReauth: false,
  };
}
