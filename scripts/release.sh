#!/usr/bin/env bash
# Build + sign Rapport for the updater, and emit latest.json.
#
# Voraussetzungen:
#   - Private Key liegt unter ~/.tauri/rapport_updater.key
#   - Version wurde in src-tauri/tauri.conf.json, package.json UND src-tauri/Cargo.toml hochgezählt
#     (wird geprüft)
#   - Für den Standard-Build (Universal, Apple Silicon + Intel) beide Rust-Targets:
#       rustup target add aarch64-apple-darwin x86_64-apple-darwin
#
# Ablauf:
#   1) npx tauri build --target universal-apple-darwin (mit Signing-Env)
#      RELEASE_TARGET=native baut wie früher nur für die eigene Architektur.
#   2) liest die erzeugte .sig-Datei
#   3) schreibt latest.json im Repo-Root mit URLs auf Gitea-Release-Assets — beim Universal-Build
#      für darwin-aarch64 und darwin-x86_64 (dasselbe Bundle), damit auch Intel-Macs Updates bekommen.
#      Windows/Linux brauchen einen eigenen Build auf der jeweiligen Plattform (nicht Teil dieses Skripts).
#
# Danach manuell:
#   - auf Gitea einen Release mit Tag <VERSION> erstellen (OHNE v-Prefix — latest.json verlinkt /releases/download/<VERSION>/)
#   - die .app.tar.gz und (optional) die .dmg als Assets hochladen
#   - latest.json committen + auf main pushen

set -euo pipefail

cd "$(dirname "$0")/.."

KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/rapport_updater.key}"
GITEA_REPO="https://git.openbureau.ch/karim/RAPPORT"

if [ ! -f "$KEY_PATH" ]; then
  echo "Private Key fehlt: $KEY_PATH" >&2
  exit 1
fi

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
PKG_VERSION=$(node -p "require('./package.json').version")
# Erste `version = "…"`-Zeile in Cargo.toml (die des [package]-Abschnitts)
CARGO_VERSION=$(sed -n 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' src-tauri/Cargo.toml | head -n1)
if [ "$VERSION" != "$PKG_VERSION" ] || [ "$VERSION" != "$CARGO_VERSION" ]; then
  echo "Version mismatch: tauri.conf.json=$VERSION  package.json=$PKG_VERSION  Cargo.toml=$CARGO_VERSION" >&2
  exit 1
fi

RELEASE_TARGET="${RELEASE_TARGET:-universal}"
if [ "$RELEASE_TARGET" = "universal" ]; then
  for t in aarch64-apple-darwin x86_64-apple-darwin; do
    if ! rustup target list --installed 2>/dev/null | grep -qx "$t"; then
      echo "Rust-Target $t fehlt: rustup target add $t  (oder RELEASE_TARGET=native für den alten Build)" >&2
      exit 1
    fi
  done
  PLATFORM_KEYS="darwin-aarch64 darwin-x86_64"
  BUILD_ARGS=(--target universal-apple-darwin)
  BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle/macos"
else
  ARCH=$(uname -m)
  case "$ARCH" in
    arm64|aarch64) PLATFORM_KEYS="darwin-aarch64" ;;
    x86_64)        PLATFORM_KEYS="darwin-x86_64" ;;
    *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
  esac
  BUILD_ARGS=()
  BUNDLE_DIR="src-tauri/target/release/bundle/macos"
fi

echo "→ Build Rapport $VERSION ($PLATFORM_KEYS)"
TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npx tauri build ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}

TAR_GZ=$(ls "$BUNDLE_DIR"/*.app.tar.gz 2>/dev/null | head -n1 || true)
SIG_FILE="${TAR_GZ}.sig"

if [ -z "$TAR_GZ" ] || [ ! -f "$SIG_FILE" ]; then
  echo "Bundle oder Signatur fehlt in $BUNDLE_DIR" >&2
  exit 1
fi

ASSET_NAME=$(basename "$TAR_GZ")
ASSET_URL_NAME=$(printf '%s' "$ASSET_NAME" | sed 's/ /%20/g')
SIGNATURE=$(cat "$SIG_FILE")
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DOWNLOAD_URL="$GITEA_REPO/releases/download/$VERSION/$ASSET_URL_NAME"

NOTES=${RELEASE_NOTES:-"Rapport $VERSION"}

# latest.json mit einem Eintrag je Plattform (Universal: beide Mac-Architekturen → dasselbe Bundle)
node -e '
  const [version, notes, pubDate, signature, url, ...keys] = process.argv.slice(1);
  const platforms = Object.fromEntries(keys.map(k => [k, { signature, url }]));
  process.stdout.write(JSON.stringify({ version, notes, pub_date: pubDate, platforms }, null, 2) + "\n");
' "$VERSION" "$NOTES" "$PUB_DATE" "$SIGNATURE" "$DOWNLOAD_URL" $PLATFORM_KEYS > latest.json

echo
echo "✓ Build fertig"
echo "  Bundle:    $TAR_GZ"
echo "  Signatur:  $SIG_FILE"
echo "  DMG:       $(ls "$BUNDLE_DIR"/*.dmg 2>/dev/null | head -n1 || echo '(keine DMG gefunden)')"
echo "  Platform:  $PLATFORM_KEYS"
echo "  latest.json wurde im Repo-Root geschrieben."
echo
echo "Nächste Schritte:"
echo "  1) Auf Gitea Release mit Tag $VERSION erstellen und folgende Assets hochladen:"
echo "       - $ASSET_NAME"
echo "       - (optional) DMG für Erstinstallation"
echo "  2) latest.json committen + auf main pushen:"
echo "       git add latest.json && git commit -m 'Release $VERSION' && git push origin main"
