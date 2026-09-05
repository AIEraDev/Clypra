#!/bin/bash
# setup-ffmpeg.sh — Ensure static FFmpeg 8.0 libraries exist for Clypra native builds.
#
# This script builds a minimal, self-contained static FFmpeg if src-tauri/ffmpeg-static
# does not already exist.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$PROJECT_ROOT/src-tauri/ffmpeg-static"

if [ -f "$TARGET_DIR/lib/libavcodec.a" ] && [ -f "$TARGET_DIR/lib/libavformat.a" ]; then
  echo "✅ Static FFmpeg libraries found at: $TARGET_DIR"
  exit 0
fi

echo "📦 Static FFmpeg not found. Building static FFmpeg 8.0 for Clypra..."

TMP_BUILD_DIR="$(mktemp -d /tmp/ffmpeg-build.XXXXXX)"
cleanup() {
  rm -rf "$TMP_BUILD_DIR"
}
trap cleanup EXIT

FFMPEG_VERSION="8.0"
FFMPEG_TAR="ffmpeg-${FFMPEG_VERSION}.tar.xz"
FFMPEG_URL="https://ffmpeg.org/releases/${FFMPEG_TAR}"

echo "⬇️ Downloading ${FFMPEG_URL}..."
curl -fsSL "$FFMPEG_URL" -o "$TMP_BUILD_DIR/$FFMPEG_TAR"

echo "📂 Extracting FFmpeg..."
tar -xf "$TMP_BUILD_DIR/$FFMPEG_TAR" -C "$TMP_BUILD_DIR"
cd "$TMP_BUILD_DIR/ffmpeg-${FFMPEG_VERSION}"

OS="$(uname -s)"
EXTRA_FLAGS=()

if [ "$OS" = "Darwin" ]; then
  EXTRA_FLAGS=(
    "--enable-videotoolbox"
    "--enable-audiotoolbox"
    "--disable-xlib"
    "--disable-libxcb"
    "--disable-indev=xcbgrab"
  )
elif [ "$OS" = "Linux" ]; then
  EXTRA_FLAGS=(
    "--enable-vaapi"
  )
fi

echo "⚙️ Configuring FFmpeg (static-only, PIC)..."
./configure \
  --prefix="$TARGET_DIR" \
  --enable-static \
  --disable-shared \
  --enable-pic \
  --disable-programs \
  --disable-doc \
  --disable-network \
  "${EXTRA_FLAGS[@]}"

echo "🔨 Compiling static libraries (using $(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4) cores)..."
make -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
make install

echo "✅ Static FFmpeg successfully installed to $TARGET_DIR"
