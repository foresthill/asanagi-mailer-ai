import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep mail/IMAP/SMTP libraries OUT of the webpack bundle. These packages use
  // dynamic requires and native-ish internals; when webpack bundles them they
  // break at runtime (the standalone server throws on import before any code in
  // the route runs). Listing them here makes Next (a) load them from node_modules
  // at runtime and (b) trace them into `.next-standalone/standalone/node_modules`
  // so the packaged desktop app actually ships them. Without this, IMAP/SMTP
  // "設定に失敗しました" with an empty 動作ログ because the route 500s on import.
  // imapflow / mailparser は動的 require 等でバンドルすると壊れるので external に
  // する（standalone の node_modules に同梱される）。nodemailer は external にすると
  // 深いサブパス import（nodemailer/lib/mail-composer）をバンドラが解決できず
  // 「can't be external」エラーになるため external にしない（純JSなのでバンドルで
  // 問題なく、ランタイムでも動く）。
  serverExternalPackages: ["imapflow", "mailparser"],

  // NOTE: `outputFileTracingExcludes` を使ってはいけない（Turbopack 16.2.7 と非互換）。
  // 以前ここで src-tauri 等を除外しようとしたが、Turbopack のトレースが壊れ、standalone
  // 出力から SSR チャンク（`.next-standalone/server/chunks/ssr/[turbopack]_runtime.js`）が
  // 取りこぼされ、パッケージ版が起動直後に 500（Cannot find module ...[turbopack]_runtime）
  // になった（app-v0.5.4 の事故）。src-tauri/.data 等の不要物の除去は **ビルド後に**
  // `scripts/copy-standalone-assets.mjs` の PRUNE_ROOT / PRUNE_MODULES で行う（そちらが
  // 正しい方法）。この非互換は回帰しやすいので CI の standalone スモークテスト
  // (.github/workflows/standalone-smoke.yml) で「起動して / が 200」を必ず検証する。

  // Desktop (Tauri) packaging builds a self-contained Node server with
  // `BUILD_STANDALONE=1 next build` → .next-standalone/standalone/server.js.
  // Gated by env AND written to a SEPARATE distDir so it never clobbers the
  // running `next dev` (.next) — that mistake breaks the live dev server.
  ...(process.env.BUILD_STANDALONE === "1"
    ? { output: "standalone" as const, distDir: ".next-standalone" }
    : {}),
};

export default nextConfig;
