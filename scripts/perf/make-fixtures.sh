#!/usr/bin/env bash
set -euo pipefail

# Generate deterministic media fixtures for the native decoder self-test. The
# output directory is explicit so this script never writes into a user's media
# library or a temporary directory that can be mistaken for a session log.
output_dir="${1:-tests/fixtures/perf}"
mkdir -p "$output_dir"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to generate performance fixtures" >&2
  exit 2
fi

hevc_encoder=(libx265)
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q "hevc_videotoolbox"; then
  hevc_encoder=(hevc_videotoolbox)
fi

h264_encoder=(libx264)
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q "h264_videotoolbox"; then
  h264_encoder=(h264_videotoolbox)
fi

ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=640x360:rate=30" -t 2 \
  -vf format=yuv420p10le -c:v "${hevc_encoder[@]}" -pix_fmt yuv420p10le \
  -tag:v hvc1 -movflags +faststart \
  "$output_dir/hevc-main10-video-range.mov"

ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=640x360:rate=30" -t 2 \
  -vf format=yuvj420p -c:v "${h264_encoder[@]}" -pix_fmt yuvj420p \
  -movflags +faststart \
  "$output_dir/h264-8bit-full-range.mov"

echo "Generated decoder fixtures in $output_dir"
