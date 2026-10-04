#!/usr/bin/env bash
# ==============================================================================
# Clypra Benchmarks — Synthetic Test Fixtures Generator
# Generates the 5 standardized benchmark video assets with exact codec and GOP
# parameters matching Claude's protocol.
# ==============================================================================

set -euo pipefail

DEST_DIR="${1:-$HOME/clypra-fixtures}"
mkdir -p "$DEST_DIR"
cd "$DEST_DIR"

echo "================================================================="
echo "Generating Clypra benchmark fixtures in: $DEST_DIR"
echo "================================================================="

# 1. 1440p25 H.264, 1s GOP (25 frames), faststart index at start
if [ ! -f "clip_1440p25_gop1s.mp4" ]; then
  echo "--> [1/5] Generating clip_1440p25_gop1s.mp4 (60s, GOP 1s)..."
  ffmpeg -y -f lavfi -i "testsrc2=size=2560x1440:rate=25" -f lavfi -i "sine=frequency=440:beep_factor=4" \
    -t 60 -vf "noise=alls=12:allf=t" -c:v libx264 -preset medium -b:v 15M -maxrate 15M -bufsize 30M \
    -g 25 -pix_fmt yuv420p -c:a aac -ar 48000 -ac 2 -movflags +faststart clip_1440p25_gop1s.mp4
else
  echo "--> [1/5] clip_1440p25_gop1s.mp4 already exists, skipping."
fi

# 2. 1440p25 H.264, 10s GOP (250 frames), faststart index at start
if [ ! -f "clip_1440p25_gop10s.mp4" ]; then
  echo "--> [2/5] Generating clip_1440p25_gop10s.mp4 (60s, GOP 10s)..."
  ffmpeg -y -f lavfi -i "testsrc2=size=2560x1440:rate=25" -f lavfi -i "sine=frequency=440:beep_factor=4" \
    -t 60 -vf "noise=alls=12:allf=t" -c:v libx264 -preset medium -b:v 15M -maxrate 15M -bufsize 30M \
    -g 250 -pix_fmt yuv420p -c:a aac -ar 48000 -ac 2 -movflags +faststart clip_1440p25_gop10s.mp4
else
  echo "--> [2/5] clip_1440p25_gop10s.mp4 already exists, skipping."
fi

# 3. 1440p25 H.264, 1s GOP (25 frames), index at end (no faststart)
if [ ! -f "clip_1440p25_moovend.mp4" ]; then
  echo "--> [3/5] Generating clip_1440p25_moovend.mp4 (60s, moov atom at end)..."
  ffmpeg -y -f lavfi -i "testsrc2=size=2560x1440:rate=25" -f lavfi -i "sine=frequency=440:beep_factor=4" \
    -t 60 -vf "noise=alls=12:allf=t" -c:v libx264 -preset medium -b:v 15M -maxrate 15M -bufsize 30M \
    -g 25 -pix_fmt yuv420p -c:a aac -ar 48000 -ac 2 clip_1440p25_moovend.mp4
else
  echo "--> [3/5] clip_1440p25_moovend.mp4 already exists, skipping."
fi

# 4. A/V Sync test: 720p25 with visual timecode and 1s periodic beeps
if [ ! -f "sync_test.mp4" ]; then
  echo "--> [4/5] Generating sync_test.mp4 (60s A/V sync)..."
  ffmpeg -y -f lavfi -i "testsrc2=size=1280x720:rate=25" -f lavfi -i "sine=frequency=1000:beep_factor=4" \
    -t 60 -c:v libx264 -preset fast -pix_fmt yuv420p -c:a aac sync_test.mp4
else
  echo "--> [4/5] sync_test.mp4 already exists, skipping."
fi

# 5. Long clip: 20 minutes 720p (crosses 11.6 min PCM audio cap)
if [ ! -f "long_20min_720p.mp4" ]; then
  echo "--> [5/5] Generating long_20min_720p.mp4 (1200s, 20 minutes)..."
  ffmpeg -y -f lavfi -i "testsrc2=size=1280x720:rate=25" -f lavfi -i "sine=frequency=440" \
    -t 1200 -c:v libx264 -preset veryfast -b:v 3M -pix_fmt yuv420p -c:a aac long_20min_720p.mp4
else
  echo "--> [5/5] long_20min_720p.mp4 already exists, skipping."
fi

echo "================================================================="
echo "Generating SHA-256 Checksums into checksums.txt..."
shasum -a 256 *.mp4 | tee checksums.txt

echo "================================================================="
echo "Done! Copy the contents of '$DEST_DIR' to 'C:\\clypra-fixtures\\' on Windows."
echo "Verify on Windows using: Get-FileHash C:\\clypra-fixtures\\*.mp4"
echo "================================================================="
