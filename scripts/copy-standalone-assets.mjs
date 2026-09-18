// Next.js `output: "standalone"` emits <distDir>/standalone/server.js but does
// NOT copy static assets or /public — we must place them next to the server so
// the self-contained desktop (Tauri sidecar) build serves CSS/JS/images.
// The desktop build uses a separate distDir (.next-standalone) so it never
// clobbers the running `next dev` (.next).
// https://nextjs.org/docs/app/api-reference/config/next-config-js/output
import { cp, access, rm, lstat } from "node:fs/promises";
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

// Slim the desktop bundle: local NER (@huggingface/transformers + onnxruntime)
// weighs hundreds of MB and is opt-in — structured PII masking works without it,
// and NER load failures are swallowed (see lib/ai/pii.ts / ner.ts). Drop it from
// the standalone output so the installer stays small. (next.config
// outputFileTracingExcludes crashes Turbopack in 16.2.7, so we prune here.)
const PRUNE_MODULES = [
  "@huggingface",
  "onnxruntime-node",
  "onnxruntime-web",
  "onnxruntime-common",
  "sharp",
  "@emnapi",
];
// lstat-based existence: catches symlinks too (a dangling symlink fails `access`,
// so it would be skipped — but Next links the nested copy to the top-level one,
// and leaving that link dangling breaks Tauri's resource bundling).
async function lexists(p) {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}
// Next puts node_modules both at the root and inside the nested distDir output.
const MODULE_ROOTS = [
  path.join(standalone, "node_modules"),
  path.join(standalone, DIST, "node_modules"),
];
let pruned = 0;
for (const root of MODULE_ROOTS) {
  for (const pkg of PRUNE_MODULES) {
    const p = path.join(root, pkg);
    if (await lexists(p)) {
      await rm(p, { recursive: true, force: true });
      pruned++;
    }
  }
}

// Next's file tracing over-copies the project root into the standalone output.
// Strip what the Node server never needs — critically `.data` (contains OAuth
// tokens / BYOK keys and the local DB: must never ship in a distributed bundle),
// plus the Rust build dir and VCS/source. The server's runtime `.data` is
// created fresh at ASANAGI_DATA_DIR (or cwd). Keep `.next-standalone/` (the
// compiled server output) and node_modules.
const PRUNE_ROOT = [".data", ".git", "src-tauri", "src", "docs", "tsconfig.tsbuildinfo"];
for (const name of PRUNE_ROOT) {
  const p = path.join(standalone, name);
  if (await exists(p)) {
    await rm(p, { recursive: true, force: true });
    pruned++;
  }
}
console.log(`[copy-standalone-assets] pruned ${pruned} item(s) for a smaller, secret-free desktop bundle`);
