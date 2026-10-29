#!/usr/bin/env bash
# Build + sign Rapport for the updater, and emit latest.json.
#
# Voraussetzungen:
#   - Private Key liegt unter ~/.tauri/rapport_updater.key
#   - Version wurde in src-tauri/tauri.conf.json + package.json hochgezählt
#
# Ablauf:
#   1) npm run tauri build (mit Signing-Env)
#   2) liest die erzeugte .sig-Datei
#   3) schreibt latest.json im Repo-Root mit URLs auf Gitea-Release-Assets
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
if [ "$VERSION" != "$PKG_VERSION" ]; then
  echo "Version mismatch: tauri.conf.json=$VERSION  package.json=$PKG_VERSION" >&2
  exit 1
fi

ARCH=$(uname -m)
case "$ARCH" in
  arm64|aarch64) PLATFORM_KEY="darwin-aarch64" ;;
  x86_64)        PLATFORM_KEY="darwin-x86_64" ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

echo "→ Build Rapport $VERSION ($PLATFORM_KEY)"
TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npx tauri build

BUNDLE_DIR="src-tauri/target/release/bundle/macos"
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

cat > latest.json <<EOF
{
  "version": "$VERSION",
  "notes": $(node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$NOTES"),
  "pub_date": "$PUB_DATE",
  "platforms": {
    "$PLATFORM_KEY": {
      "signature": $(node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$SIGNATURE"),
      "url": "$DOWNLOAD_URL"
    }
  }
}
EOF

echo
echo "✓ Build fertig"
echo "  Bundle:    $TAR_GZ"
echo "  Signatur:  $SIG_FILE"
echo "  DMG:       $(ls "$BUNDLE_DIR"/*.dmg 2>/dev/null | head -n1 || echo '(keine DMG gefunden)')"
echo "  Platform:  $PLATFORM_KEY"
echo "  latest.json wurde im Repo-Root geschrieben."
echo
echo "Nächste Schritte:"
echo "  1) Auf Gitea Release mit Tag $VERSION erstellen und folgende Assets hochladen:"
echo "       - $ASSET_NAME"
echo "       - (optional) DMG für Erstinstallation"
echo "  2) latest.json committen + auf main pushen:"
echo "       git add latest.json && git commit -m 'Release $VERSION' && git push origin main"
