#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

VERSION="$(node -p "require('./package.json').version")"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "package.jsonのversionは 1.2.3 形式で指定してください。" >&2
  exit 1
fi

APP_PATH="dist/Naoki Cutter-darwin-arm64/Naoki Cutter.app"
RELEASE_DIR="release/v${VERSION}"
ZIP_PATH="${RELEASE_DIR}/Naoki-Cutter-mac-arm64.zip"

npx electron-packager . "Naoki Cutter" \
  --platform=darwin \
  --arch=arm64 \
  --out=dist \
  --overwrite \
  '--ignore=^/release($|/)' \
  --app-bundle-id=com.naoki.cutter

/usr/bin/codesign --remove-signature "$APP_PATH" 2>/dev/null || true
/usr/bin/codesign --deep --force --sign - "$APP_PATH"
/usr/bin/codesign --verify --deep --strict "$APP_PATH"

/bin/mkdir -p "$RELEASE_DIR"
/bin/rm -f "$ZIP_PATH"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

echo "リリースZIPを作成しました: $ZIP_PATH"
echo "次のタグ: v${VERSION}"
