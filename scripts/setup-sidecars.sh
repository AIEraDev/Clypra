#!/usr/bin/env bash
# scripts/setup-sidecars.sh
# Downloads and cryptographically verifies static FFmpeg and FFprobe sidecars
# for packaging Clypra releases and local development.
#
# Usage:
#   ./scripts/setup-sidecars.sh                      # Sets up sidecars for current host
#   ./scripts/setup-sidecars.sh --target <triple>    # Sets up specific target triple
#   ./scripts/setup-sidecars.sh --all                # Sets up all supported targets
#
# Supported target triples:
#   aarch64-apple-darwin
#   x86_64-apple-darwin
#   x86_64-unknown-linux-gnu
#   aarch64-unknown-linux-gnu
#   x86_64-pc-windows-msvc

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$PROJECT_ROOT/src-tauri/bin"

mkdir -p "$BIN_DIR"

BASE_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1"

get_ffmpeg_archive() {
  case "$1" in
    aarch64-apple-darwin) echo "ffmpeg-darwin-arm64.gz" ;;
    x86_64-apple-darwin) echo "ffmpeg-darwin-x64.gz" ;;
    x86_64-unknown-linux-gnu) echo "ffmpeg-linux-x64.gz" ;;
    aarch64-unknown-linux-gnu) echo "ffmpeg-linux-arm64.gz" ;;
    x86_64-pc-windows-msvc) echo "ffmpeg-win32-x64.gz" ;;
    *) return 1 ;;
  esac
}

get_ffmpeg_sha() {
  case "$1" in
    aarch64-apple-darwin) echo "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa" ;;
    x86_64-apple-darwin) echo "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106" ;;
    x86_64-unknown-linux-gnu) echo "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa" ;;
    aarch64-unknown-linux-gnu) echo "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0" ;;
    x86_64-pc-windows-msvc) echo "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77" ;;
    *) return 1 ;;
  esac
}

get_ffprobe_archive() {
  case "$1" in
    aarch64-apple-darwin) echo "ffprobe-darwin-arm64.gz" ;;
    x86_64-apple-darwin) echo "ffprobe-darwin-x64.gz" ;;
    x86_64-unknown-linux-gnu) echo "ffprobe-linux-x64.gz" ;;
    aarch64-unknown-linux-gnu) echo "ffprobe-linux-arm64.gz" ;;
    x86_64-pc-windows-msvc) echo "ffprobe-win32-x64.gz" ;;
    *) return 1 ;;
  esac
}

get_ffprobe_sha() {
  case "$1" in
    aarch64-apple-darwin) echo "d986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be" ;;
    x86_64-apple-darwin) echo "d4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186" ;;
    x86_64-unknown-linux-gnu) echo "25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067" ;;
    aarch64-unknown-linux-gnu) echo "2ab6aba60ee84412dff9188720703376cb4e7aaf7e0b5e43aa8249f2acae5bf8" ;;
    x86_64-pc-windows-msvc) echo "f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d" ;;
    *) return 1 ;;
  esac
}

detect_host_target() {
  local os
  local arch
  os="$(uname -s)"
  arch="$(uname -m)"

  if [ "$os" = "Darwin" ]; then
    if [ "$arch" = "arm64" ]; then
      echo "aarch64-apple-darwin"
    else
      echo "x86_64-apple-darwin"
    fi
  elif [ "$os" = "Linux" ]; then
    if [ "$arch" = "x86_64" ]; then
      echo "x86_64-unknown-linux-gnu"
    elif [ "$arch" = "aarch64" ] || [ "$arch" = "arm64" ]; then
      echo "aarch64-unknown-linux-gnu"
    else
      echo "❌ Unsupported Linux architecture: $arch" >&2
      exit 1
    fi
  elif echo "$os" | grep -Eq 'MINGW|MSYS|CYGWIN'; then
    echo "x86_64-pc-windows-msvc"
  else
    echo "❌ Unsupported operating system: $os" >&2
    exit 1
  fi
}

verify_sha256() {
  local file="$1"
  local expected="$2"
  local actual=""

  if command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$file" | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$file" | awk '{print $1}')
  elif command -v python3 >/dev/null 2>&1; then
    actual=$(python3 -c "import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], 'rb').read()).hexdigest())" "$file")
  else
    echo "❌ Error: Neither shasum, sha256sum, nor python3 available to verify checksum." >&2
    return 1
  fi

  if [ "$actual" != "$expected" ]; then
    echo "❌ SHA-256 checksum mismatch for $(basename "$file")!" >&2
    echo "   Expected: $expected" >&2
    echo "   Actual:   $actual" >&2
    return 1
  fi
  echo "🔒 SHA-256 verified: $actual"
  return 0
}

install_target() {
  local target="$1"
  local host_target
  host_target="$(detect_host_target 2>/dev/null || echo "")"

  echo "============================================================"
  echo "📦 Installing sidecars for target: $target"
  echo "============================================================"

  local ffmpeg_archive
  local ffmpeg_sha
  local ffprobe_archive
  local ffprobe_sha

  if ! ffmpeg_archive="$(get_ffmpeg_archive "$target")" || ! ffmpeg_sha="$(get_ffmpeg_sha "$target")"; then
    echo "❌ Unknown target triple: $target" >&2
    echo "Supported targets: aarch64-apple-darwin, x86_64-apple-darwin, x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu, x86_64-pc-windows-msvc" >&2
    exit 1
  fi

  ffprobe_archive="$(get_ffprobe_archive "$target")"
  ffprobe_sha="$(get_ffprobe_sha "$target")"

  local ext=""
  if [ "$target" = "x86_64-pc-windows-msvc" ]; then
    ext=".exe"
  fi

  local ffmpeg_dest="$BIN_DIR/ffmpeg-${target}${ext}"
  local ffprobe_dest="$BIN_DIR/ffprobe-${target}${ext}"

  if [ "${FORCE:-0}" -ne 1 ] && [ -f "$ffmpeg_dest" ] && [ -f "$ffprobe_dest" ]; then
    local size_ffmpeg
    local size_ffprobe
    size_ffmpeg=$(wc -c < "$ffmpeg_dest" 2>/dev/null || echo 0)
    size_ffprobe=$(wc -c < "$ffprobe_dest" 2>/dev/null || echo 0)
    if [ "$size_ffmpeg" -gt 1000000 ] && [ "$size_ffprobe" -gt 1000000 ]; then
      echo "✅ Sidecars already installed for $target (ffmpeg: $(ls -lh "$ffmpeg_dest" | awk '{print $5}'), ffprobe: $(ls -lh "$ffprobe_dest" | awk '{print $5}'))."
      echo "   Pass --force to re-download."
      return 0
    fi
  fi

  local tmp_dir
  tmp_dir="$(mktemp -d /tmp/clypra-sidecars.XXXXXX)"
  trap 'rm -rf "$tmp_dir"' EXIT

  # Download & install FFmpeg
  echo "⬇️ Downloading FFmpeg: $ffmpeg_archive..."
  curl -fsSL "$BASE_URL/$ffmpeg_archive" -o "$tmp_dir/$ffmpeg_archive"
  verify_sha256 "$tmp_dir/$ffmpeg_archive" "$ffmpeg_sha"
  echo "📂 Extracting to $ffmpeg_dest..."
  gzip -dc "$tmp_dir/$ffmpeg_archive" > "$ffmpeg_dest"
  chmod +x "$ffmpeg_dest"

  # Download & install FFprobe
  echo "⬇️ Downloading FFprobe: $ffprobe_archive..."
  curl -fsSL "$BASE_URL/$ffprobe_archive" -o "$tmp_dir/$ffprobe_archive"
  verify_sha256 "$tmp_dir/$ffprobe_archive" "$ffprobe_sha"
  echo "📂 Extracting to $ffprobe_dest..."
  gzip -dc "$tmp_dir/$ffprobe_archive" > "$ffprobe_dest"
  chmod +x "$ffprobe_dest"

  rm -rf "$tmp_dir"
  trap - EXIT

  echo "✅ Installed:"
  echo "   - $ffmpeg_dest ($(ls -lh "$ffmpeg_dest" | awk '{print $5}'))"
  echo "   - $ffprobe_dest ($(ls -lh "$ffprobe_dest" | awk '{print $5}'))"

  # Sanity-check executable if target matches current host
  if [ "$target" = "$host_target" ]; then
    echo "🧪 Verifying local execution..."
    "$ffmpeg_dest" -version | head -n 1
    "$ffprobe_dest" -version | head -n 1
    echo "✅ Local execution verified."
  fi
}

# Parse CLI arguments
TARGETS=()
if [ $# -eq 0 ]; then
  TARGETS=("$(detect_host_target)")
else
  while [ $# -gt 0 ]; do
    case "$1" in
      --target)
        if [ -z "${2:-}" ]; then
          echo "❌ Missing argument for --target" >&2
          exit 1
        fi
        TARGETS+=("$2")
        shift 2
        ;;
      --force)
        FORCE=1
        shift
        ;;
      --all)
        TARGETS=("aarch64-apple-darwin" "x86_64-apple-darwin" "x86_64-unknown-linux-gnu" "aarch64-unknown-linux-gnu" "x86_64-pc-windows-msvc")
        shift
        ;;
      -h|--help)
        echo "Usage: $0 [--target <triple>] [--all] [--force]"
        exit 0
        ;;
      *)
        echo "❌ Unknown argument: $1" >&2
        exit 1
        ;;
    esac
  done
fi

for t in "${TARGETS[@]}"; do
  install_target "$t"
done

echo ""
echo "🎉 Sidecars successfully configured!"
