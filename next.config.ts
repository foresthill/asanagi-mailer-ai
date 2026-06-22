import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Desktop (Tauri) packaging builds a self-contained Node server with
  // `BUILD_STANDALONE=1 next build` → .next-standalone/standalone/server.js.
  // Gated by env AND written to a SEPARATE distDir so it never clobbers the
  // running `next dev` (.next) — that mistake breaks the live dev server.
  ...(process.env.BUILD_STANDALONE === "1"
    ? { output: "standalone" as const, distDir: ".next-standalone" }
    : {}),
};

export default nextConfig;
