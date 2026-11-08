#!/usr/bin/env bash
#
# Re-sign the bundled Node.js sidecar with OUR Developer ID + Hardened Runtime so
# macOS notarization accepts the app bundle.
#
# Why: src-tauri/binaries/node is the official Node build, signed by "Developer ID
# Application: Node.js Foundation" with get-task-allow=true. Apple notarization
# rejects any nested executable carrying get-task-allow, so we re-sign node under
# our own identity with entitlements that keep what Node needs (JIT, memory,
# library validation) but drop get-task-allow. See src-tauri/entitlements-node.plist.
#
# This runs from tauri.conf.json `beforeBuildCommand`, so it must be a harmless
# no-op anywhere real signing isn't happening:
#   - not macOS                      -> skip
#   - no Developer ID in the keychain -> skip (ad-hoc / contributor builds)
#
# Override the identity with APPLE_SIGNING_IDENTITY (e.g. in CI).
set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "sign-mac-sidecar: not macOS, skipping."
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$ROOT/src-tauri/binaries/node"
ENTITLEMENTS="$ROOT/src-tauri/entitlements-node.plist"
IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application: Naoya Morioka (M836YTN2FQ)}"

if [ ! -f "$NODE_BIN" ]; then
  echo "sign-mac-sidecar: $NODE_BIN not found, skipping."
  exit 0
fi

if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "sign-mac-sidecar: no 'Developer ID Application' in keychain, skipping (ad-hoc build)."
  exit 0
fi

echo "sign-mac-sidecar: signing node sidecar with: $IDENTITY"
codesign --force --timestamp --options runtime \
  --entitlements "$ENTITLEMENTS" \
  --sign "$IDENTITY" \
  "$NODE_BIN"

# Fail the build loudly if the re-sign didn't take (better than a silent reject at notarization).
codesign --verify --strict --verbose=2 "$NODE_BIN"
echo "sign-mac-sidecar: done. get-task-allow should now be absent:"
codesign -d --entitlements - --xml "$NODE_BIN" 2>/dev/null | grep -q "get-task-allow" \
  && { echo "sign-mac-sidecar: ERROR get-task-allow still present" >&2; exit 1; } \
  || echo "sign-mac-sidecar: OK (no get-task-allow)"
