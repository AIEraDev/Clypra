#!/bin/bash
# tauri-dev.sh — Run Clypra in dev mode with camera/mic working on macOS.
#
# WHY A BUNDLE IS NEEDED:
#   WKWebView camera access on macOS requires TCC to show a permission prompt.
#   TCC only prompts for properly bundled .app packages (with Info.plist containing
#   NSCameraUsageDescription). A bare binary at target/debug/clypra has no bundle,
#   so TCC silently denies all getUserMedia requests regardless of entitlements.
#
#   This script creates a minimal .app bundle wrapper around the debug binary,
#   codesigns it, then launches it while Vite serves the frontend.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
BINARY="$TAURI_DIR/target/debug/clypra"
BUNDLE_DIR="$TAURI_DIR/target/debug/ClypraDev.app"
BUNDLE_BINARY="$BUNDLE_DIR/Contents/MacOS/clypra"
BUNDLE_ID="com.clypra.editor"

# ── 1. Build ──────────────────────────────────────────────────────────────────
"$SCRIPT_DIR/setup-ffmpeg.sh"
echo "🔨 Building Tauri (debug)..."
cd "$TAURI_DIR"
cargo build

# ── 2. Assemble .app bundle ───────────────────────────────────────────────────
echo "📦 Assembling ClypraDev.app bundle..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/Contents/MacOS"
mkdir -p "$BUNDLE_DIR/Contents/Resources"

# Copy binary
cp "$BINARY" "$BUNDLE_BINARY"

# Write Info.plist (must have NSCameraUsageDescription for TCC to prompt)
cat > "$BUNDLE_DIR/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Clypra</string>
    <key>CFBundleIdentifier</key>
    <string>$BUNDLE_ID</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleExecutable</key>
    <string>clypra</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSCameraUsageDescription</key>
    <string>Clypra requires camera access for dual screen and webcam recording.</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>Clypra requires microphone access for audio recording during screen capture.</string>
    <key>NSScreenCaptureUsageDescription</key>
    <string>Clypra requires screen recording access to capture your screen content.</string>
</dict>
</plist>
EOF

# ── 3. Codesign the bundle ────────────────────────────────────────────────────
echo "🔏 Codesigning bundle with camera/mic entitlements..."

# Write dev entitlements to a temp file
DEV_ENT="$(mktemp /tmp/clypra-dev-ent.XXXXXX.plist)"
cat > "$DEV_ENT" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.device.camera</key>
    <true/>
    <key>com.apple.security.device.microphone</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.get-task-allow</key>
    <true/>
</dict>
</plist>
EOF

codesign --force --deep --sign - \
  --identifier "$BUNDLE_ID" \
  --entitlements "$DEV_ENT" \
  "$BUNDLE_DIR"
rm -f "$DEV_ENT"

echo "✅ Bundle signed: $BUNDLE_DIR"

# ── 4. Reset TCC so macOS prompts for permission (only if no grant exists) ────
if ! tccutil reset Camera "$BUNDLE_ID" 2>/dev/null | grep -q "no entries"; then
  echo "🔄 Resetting TCC camera grant to trigger fresh permission prompt..."
  tccutil reset Camera "$BUNDLE_ID" 2>/dev/null || true
  tccutil reset Microphone "$BUNDLE_ID" 2>/dev/null || true
fi

# ── 5. Start Vite dev server ──────────────────────────────────────────────────
echo "🚀 Starting Vite dev server..."
cd "$PROJECT_ROOT"

# Kill any stale vite process on port 1420
lsof -ti:1420 | xargs kill -9 2>/dev/null || true
sleep 0.5

npm run dev &
VITE_PID=$!

echo "⏳ Waiting for dev server on http://localhost:1420..."
for i in $(seq 1 30); do
  if curl -s http://localhost:1420 > /dev/null 2>&1; then
    echo "✅ Dev server ready."
    break
  fi
  sleep 1
done

# ── 6. Launch .app bundle ─────────────────────────────────────────────────────
echo "🎬 Launching ClypraDev.app..."
open -W "$BUNDLE_DIR"

# Cleanup on exit
echo "🧹 Shutting down dev server..."
kill $VITE_PID 2>/dev/null || true
