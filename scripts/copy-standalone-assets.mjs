// Next.js `output: "standalone"` emits <distDir>/standalone/server.js but does
// NOT copy static assets or /public — we must place them next to the server so
// the self-contained desktop (Tauri sidecar) build serves CSS/JS/images.
// The desktop build uses a separate distDir (.next-standalone) so it never
// clobbers the running `next dev` (.next).
// https://nextjs.org/docs/app/api-reference/config/next-config-js/output
import { cp, access } from "node:fs/promises";
import path from "node:path";

const DIST = ".next-standalone"; // must match next.config.ts distDir
const root = process.cwd();
const standalone = path.join(root, DIST, "standalone");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(path.join(standalone, "server.js")))) {
  console.error(
    `[copy-standalone-assets] ${DIST}/standalone/server.js not found.\n` +
      "Run `BUILD_STANDALONE=1 next build` first (see npm run build:standalone).",
  );
  process.exit(1);
}

// <DIST>/static → <DIST>/standalone/<DIST>/static (the server resolves static
// relative to its own distDir name).
await cp(path.join(root, DIST, "static"), path.join(standalone, DIST, "static"), {
  recursive: true,
});

// public → <DIST>/standalone/public (skipped if the project has no /public)
if (await exists(path.join(root, "public"))) {
  await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
}

console.log(`[copy-standalone-assets] copied static + public into ${DIST}/standalone`);
