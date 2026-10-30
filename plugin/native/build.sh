#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-release}"

# Resolve a Swift compiler. xcrun refuses to run until the Xcode licence is
# accepted, so fall back to the toolchain and the SDK directly, which needs no
# licence. Set SWIFTC to override the compiler.
if [[ -n "${SWIFTC:-}" ]]; then
  COMPILER=("$SWIFTC")
  TARGET="$(uname -m)-apple-macosx13.0"
elif xcrun --sdk macosx swiftc --version >/dev/null 2>&1; then
  COMPILER=(xcrun --sdk macosx swiftc)
  TARGET="$(uname -m)-apple-macosx13.0"
else
  TOOLCHAIN="/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc"
  PLATFORM="/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs"
  SDK="$(ls -d "$PLATFORM"/MacOSX*.sdk 2>/dev/null | sort -V | tail -1)"
  if [[ -z "$SDK" || ! -x "$TOOLCHAIN" ]]; then
    printf 'no usable Swift compiler: accept the Xcode licence or set SWIFTC\n' >&2
    exit 2
  fi
  SDK_VERSION="$(basename "$SDK" .sdk)"
  SDK_VERSION="${SDK_VERSION#MacOSX}"
  COMPILER=("$TOOLCHAIN" -sdk "$SDK")
  TARGET="$(uname -m)-apple-macosx${SDK_VERSION}"
fi

mkdir -p "$ROOT/bin" "$ROOT/build"

case "$MODE" in
  --test)
    "${COMPILER[@]}" -swift-version 5 -target "$TARGET" -Onone -D CAPTURE_TESTING \
      "$ROOT/AudioCaptureCore.swift" \
      "$ROOT/AudioCaptureMain.swift" \
      "$ROOT/Tests/FakeCaptureBackend.swift" \
      -framework AVFoundation \
      -o "$ROOT/build/audio-capture-test"
    "${COMPILER[@]}" -swift-version 5 -target "$TARGET" -Onone \
      "$ROOT/AudioCaptureCore.swift" \
      "$ROOT/Tests/AudioCaptureCoreTests.swift" \
      -framework AVFoundation \
      -o "$ROOT/build/audio-capture-core-tests"
    ;;
  release)
    "${COMPILER[@]}" -swift-version 5 -target "$TARGET" -O \
      "$ROOT/AudioCaptureCore.swift" \
      "$ROOT/AudioCaptureEngine.swift" \
      "$ROOT/AudioCaptureMain.swift" \
      -framework AVFoundation \
      -framework ScreenCaptureKit \
      -framework CoreMedia \
      -framework CoreGraphics \
      -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$ROOT/Info.plist" \
      -o "$ROOT/bin/audio-capture"
    "${COMPILER[@]}" -swift-version 5 -target "$TARGET" -O -parse-as-library \
      "$ROOT/FloatingOverlay.swift" \
      -framework SwiftUI \
      -framework AppKit \
      -o "$ROOT/bin/floating-overlay"
    ;;
  *)
    printf 'usage: %s [--test]\n' "$0" >&2
    exit 2
    ;;
esac
