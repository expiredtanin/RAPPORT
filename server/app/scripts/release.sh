#!/usr/bin/env bash
# Release-Pipeline: Version bumpen, signiertes Bundle bauen, latest.json generieren.
#
# Usage:   ./scripts/release.sh <version>
# Example: ./scripts/release.sh 0.2.0
#
# Vorausgesetzt:
#   - Signing-Key in ~/.rapport-signing/server-app.key (chmod 600)
#   - tauri.conf.json hat den passenden Pubkey unter plugins.updater.pubkey
#   - Docker-Daemon laeuft (fuer eventuelle Builds), Node + Rust installiert
#
# Output:
#   - Signiertes Bundle in src-tauri/target/release/bundle/
#   - latest.json im Repo-Root
#   - Commit-Hinweise in der Konsole

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.2.0"
  exit 1
fi

VERSION="$1"
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.rapport-signing/server-app.key}"

if [[ ! -f "$KEY_PATH" ]]; then
  echo "Signing-Key nicht gefunden: $KEY_PATH" >&2
  echo "Generate via: tauri signer generate -w $KEY_PATH" >&2
  exit 1
fi

# --- 1. Version in allen Manifesten bumpen ---------------------------------
echo "==> Bumpe Version auf $VERSION"

# package.json: leeres "version"-Feld auch behandeln
python3 - <<PY
import json, pathlib
p = pathlib.Path("package.json")
data = json.loads(p.read_text())
data["version"] = "$VERSION"
p.write_text(json.dumps(data, indent=2) + "\n")
PY

python3 - <<PY
import json, pathlib
p = pathlib.Path("src-tauri/tauri.conf.json")
data = json.loads(p.read_text())
data["version"] = "$VERSION"
p.write_text(json.dumps(data, indent=2) + "\n")
PY

# Cargo.toml: nur die TOP-Level [package] version (nicht Deps)
sed -i.bak -E '0,/^version = ".*"/{s/^version = ".*"/version = "'"$VERSION"'"/}' src-tauri/Cargo.toml
rm -f src-tauri/Cargo.toml.bak

# --- 2. Build (signiert automatisch durch die env-Var) ---------------------
echo "==> Build + Sign"
# tauri-bundler liest fuer den Updater-Tarball ausschliesslich TAURI_SIGNING_PRIVATE_KEY
# (Content), nicht _PATH. Wir injecten den File-Inhalt direkt.
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

npm install --silent
npm run tauri:build

# --- 3. Artefakte finden ---------------------------------------------------
BUNDLE_DIR="src-tauri/target/release/bundle"
DMG=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" 2>/dev/null | head -n 1 || true)
TARBALL=$(find "$BUNDLE_DIR/macos" -name "*.tar.gz" 2>/dev/null | head -n 1 || true)
SIG=$(find "$BUNDLE_DIR/macos" -name "*.tar.gz.sig" 2>/dev/null | head -n 1 || true)

if [[ -z "$TARBALL" || -z "$SIG" ]]; then
  echo "Updater-Tarball oder Signatur nicht gefunden!" >&2
  echo "Erwartet unter: $BUNDLE_DIR/macos/*.tar.gz(.sig)" >&2
  echo "Bundle-Output:" >&2
  ls -la "$BUNDLE_DIR" 2>&1 >&2 || true
  exit 1
fi

SIGNATURE=$(cat "$SIG")
PUB_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DOWNLOAD_URL="https://git.kgva.ch/karim/RAPPORT-SERVER-APP/releases/download/v${VERSION}/$(basename "$TARBALL")"

# --- 4. latest.json generieren --------------------------------------------
cat > latest.json <<JSON
{
  "version": "$VERSION",
  "notes": "Release $VERSION",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$SIGNATURE",
      "url": "$DOWNLOAD_URL"
    }
  }
}
JSON

echo ""
echo "================================================================"
echo "Release $VERSION fertig."
echo ""
echo "Artefakte:"
[[ -n "$DMG" ]] && echo "  DMG:     $DMG"
echo "  Tarball: $TARBALL"
echo "  Sig:     $SIG"
echo "  latest.json (im Repo-Root) — committen und nach git.kgva.ch pushen"
echo ""
echo "Naechste Schritte:"
echo "  1. gh release create v$VERSION $TARBALL $SIG ${DMG:+$DMG} -t \"v$VERSION\" -n \"Release $VERSION\""
echo "  2. git add latest.json package.json src-tauri/{Cargo.toml,tauri.conf.json}"
echo "  3. git commit -m \"Release v$VERSION\" && git push"
echo "================================================================"
