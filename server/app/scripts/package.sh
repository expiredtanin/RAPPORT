#!/usr/bin/env bash
# Build + Code-Signing-Helper.
# Ablauf:
#   1. npm install
#   2. npm run build                    (Vite-Frontend-Build)
#   3. cargo tauri build                (Tauri-Bundle)
#   4. (macOS) codesign + notarize      (nur wenn APPLE_ID/TEAM_ID gesetzt)

set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> npm install"
npm install

echo "==> tauri build"
npm run tauri:build

if [[ "$(uname -s)" == "Darwin" && -n "${APPLE_ID:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  echo "==> notarize (TODO — bundle path + xcrun notarytool aufruf)"
  # xcrun notarytool submit ... --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --wait
else
  echo "Skipping macOS notarization (APPLE_ID/APPLE_TEAM_ID not set)."
fi

echo "Done. Bundle: src-tauri/target/release/bundle/"
