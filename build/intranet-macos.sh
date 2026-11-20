#!/usr/bin/env bash
# Build Sub2Agent macOS .app update zips on macOS with Xcode tools.
set -euo pipefail
set +x
if [[ "$(uname -s)" != Darwin ]]; then echo 'Run this script on macOS with Xcode command-line tools.' >&2; exit 1; fi
VERSION="${1:-1.0.0-beta.10}"
if [[ ! "$VERSION" =~ ^([0-9]+\.[0-9]+\.[0-9]+)(-[0-9A-Za-z.-]+)?$ ]]; then echo 'Use a version such as 1.0.0-beta or 1.0.0-beta.10.' >&2; exit 1; fi
BUNDLE_VERSION="${BASH_REMATCH[1]}"
MACOS_SIGN_MODE="${MACOS_SIGN_MODE:-adhoc}"
case "$MACOS_SIGN_MODE" in
  adhoc) ;;
  developer-id)
    : "${MACOS_SIGN_IDENTITY:?Set MACOS_SIGN_IDENTITY to your Apple Developer ID Application identity}"
    : "${MACOS_NOTARY_PROFILE:?Set MACOS_NOTARY_PROFILE to an xcrun notarytool keychain profile}"
    ;;
  *) echo 'MACOS_SIGN_MODE must be adhoc or developer-id.' >&2; exit 1 ;;
esac
case "${MACOS_ARCH:-both}" in
  both) targets=(arm64 amd64) ;;
  arm64|amd64) targets=("$MACOS_ARCH") ;;
  *) echo 'MACOS_ARCH must be both, arm64, or amd64.' >&2; exit 1 ;;
esac
: "${BILLING_KEY_FILE:?Set BILLING_KEY_FILE to the admin-controlled billing signing key file}"
[[ -f "$BILLING_KEY_FILE" ]] || { echo 'Billing key file not found' >&2; exit 1; }
KEY="$(tr -d '\r\n' < "$BILLING_KEY_FILE")"
[[ "$KEY" =~ ^[0-9a-f]{64}$ ]] || { echo 'Billing key must be 64 lowercase hex characters' >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
SUB2AGENT_SOURCE="${SUB2AGENT_SOURCE:-$ROOT/../sub2agent}"
OUT="${MACOS_OUTPUT_DIR:-$ROOT/../magpie-builds/macos-$VERSION}"
if [[ -e "$OUT" ]]; then echo 'Output directory already exists; choose another MACOS_OUTPUT_DIR.' >&2; exit 1; fi
mkdir -p "$OUT"
cd "$ROOT"
command -v node >/dev/null; command -v go >/dev/null; command -v codesign >/dev/null; command -v ditto >/dev/null; command -v iconutil >/dev/null
node build/sub2agent-providers.mjs "$SUB2AGENT_SOURCE"
go run ./build/providerpack build/sub2agent-runtime internal/plugin/baseline.zip
go run -tags intranet ./build/assetpack internal/gui/assets internal/gui/assets.zip
iconset="$OUT/Sub2Agent.iconset"; mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" internal/gui/pixelbrand/app-1024.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
  doubled=$((size*2)); sips -z "$doubled" "$doubled" internal/gui/pixelbrand/app-1024.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$OUT/Sub2Agent.icns"
for target in "${targets[@]}"; do
  case "$target" in arm64) apple_arch=arm64 ;; amd64) apple_arch=x86_64 ;; esac
  dir="$OUT/$target"; app="$dir/magpie.app"; mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  env GOOS=darwin GOARCH="$target" CGO_ENABLED=1 CC="clang -arch $apple_arch" CGO_CFLAGS='-mmacosx-version-min=12.0' CGO_LDFLAGS='-mmacosx-version-min=12.0' \
    go build -trimpath -buildvcs=false -tags 'production,packedassets,intranet,embeddedproviders' \
    "-ldflags=-s -w -X main.version=$VERSION -X github.com/yetone/magpie/internal/accounting.reportSigningKey=$KEY" -o "$app/Contents/MacOS/magpie" .
  cp "$OUT/Sub2Agent.icns" "$app/Contents/Resources/magpie.icns"
  cp THIRD_PARTY_NOTICES "$app/Contents/Resources/THIRD_PARTY_NOTICES"
  sed -e "s/@VERSION@/$BUNDLE_VERSION/g" -e 's/com.yetone.magpie/com.sub2agent.app/g' build/darwin/Info.plist > "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Delete :CFBundleIconName' "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Set :CFBundleName Sub2Agent' "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName Sub2Agent' "$app/Contents/Info.plist"
  if [[ "$MACOS_SIGN_MODE" == developer-id ]]; then
    codesign --force --deep --options runtime --timestamp --sign "$MACOS_SIGN_IDENTITY" "$app"
  else
    codesign --force --deep --sign - "$app"
  fi
  codesign --verify --deep --strict "$app"
  if [[ "$MACOS_SIGN_MODE" == developer-id ]]; then
    ditto -c -k --sequesterRsrc --keepParent "$app" "$dir/notarize.zip"
    xcrun notarytool submit "$dir/notarize.zip" --keychain-profile "$MACOS_NOTARY_PROFILE" --wait
    xcrun stapler staple "$app"
    codesign --verify --deep --strict "$app"
  fi
  ditto -c -k --sequesterRsrc --keepParent "$app" "$OUT/magpie-darwin-$target.zip"
  shasum -a 256 "$OUT/magpie-darwin-$target.zip"
done
unset KEY
printf 'Created macOS archives (%s) in %s\n' "$MACOS_SIGN_MODE" "$OUT"
printf '%s\n' 'Test install and self-update on each architecture before publication.'
