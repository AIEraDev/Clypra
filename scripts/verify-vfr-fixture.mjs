#!/usr/bin/env node
/**
 * scripts/verify-vfr-fixture.mjs
 *
 * External Oracle verification of the Variable Frame Rate (VFR) test fixture.
 * Uses system ffprobe to prove that `tests/fixtures/vfr_jitter.mp4` contains
 * genuinely jittered frame intervals and r_frame_rate != avg_frame_rate.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "tests/fixtures/vfr_jitter.mp4");

console.log("🔍 Running External Oracle on tests/fixtures/vfr_jitter.mp4...\n");

if (!fs.existsSync(fixturePath)) {
  console.error(`❌ [FAIL] Fixture does not exist at ${fixturePath}`);
  process.exit(1);
}

try {
  const probeOutput = execFileSync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", fixturePath],
    { encoding: "utf8" },
  );
  const probe = JSON.parse(probeOutput);

  const videoStream = probe.streams?.find((s) => s.codec_type === "video");
  if (!videoStream) {
    console.error("❌ [FAIL] No video stream found in fixture");
    process.exit(1);
  }

  const { r_frame_rate, avg_frame_rate, duration, width, height } = videoStream;
  console.log(`  Stream: codec=${videoStream.codec_name}, resolution=${width}x${height}`);
  console.log(`  Timing: r_frame_rate=${r_frame_rate}, avg_frame_rate=${avg_frame_rate}, duration=${duration}s`);

  if (r_frame_rate === avg_frame_rate) {
    console.error(`❌ [FAIL] Fixture is CFR: r_frame_rate (${r_frame_rate}) equals avg_frame_rate (${avg_frame_rate})`);
    process.exit(1);
  }

  // Also verify packet PTS durations with ffprobe
  const packetOutput = execFileSync(
    "ffprobe",
    ["-v", "quiet", "-select_streams", "v:0", "-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", fixturePath],
    { encoding: "utf8" },
  );
  const lines = packetOutput.trim().split("\n");
  const durations = lines.map((l) => l.split(",")[1]).filter(Boolean).map(Number);
  const uniqueDurations = new Set(durations);

  console.log(`  Frames: ${lines.length} packets examined, unique frame durations: ${Array.from(uniqueDurations).join(", ")}s`);

  if (uniqueDurations.size <= 1) {
    console.error("❌ [FAIL] Packet durations do not vary across frames!");
    process.exit(1);
  }

  console.log("\n✅ External Oracle PASSED: tests/fixtures/vfr_jitter.mp4 is verified VFR media.");
  process.exit(0);
} catch (err) {
  console.error(`❌ [FAIL] ffprobe verification error: ${err.message}`);
  process.exit(1);
}
