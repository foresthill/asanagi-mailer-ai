import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep mail/IMAP/SMTP libraries OUT of the webpack bundle. These packages use
  // dynamic requires and native-ish internals; when webpack bundles them they
  // break at runtime (the standalone server throws on import before any code in
  // the route runs). Listing them here makes Next (a) load them from node_modules
  // at runtime and (b) trace them into `.next-standalone/standalone/node_modules`
  // so the packaged desktop app actually ships them. Without this, IMAP/SMTP
  // "設定に失敗しました" with an empty 動作ログ because the route 500s on import.
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser"],

  // Desktop (Tauri) packaging builds a self-contained Node server with
  // `BUILD_STANDALONE=1 next build` → .next-standalone/standalone/server.js.
  // Gated by env AND written to a SEPARATE distDir so it never clobbers the
  // running `next dev` (.next) — that mistake breaks the live dev server.
  ...(process.env.BUILD_STANDALONE === "1"
    ? { output: "standalone" as const, distDir: ".next-standalone" }
    : {}),
};

export default nextConfig;
