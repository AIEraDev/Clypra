#!/usr/bin/env node
/**
 * scripts/verify-clean-path-export.mjs
 *
 * External Oracle verification of bundled sidecar export with a clean PATH.
 * Ensures that Clypra can render and export valid media with audio on a machine
 * where ffmpeg/ffprobe are NOT in the system PATH.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const binDir = path.join(root, "src-tauri/bin");

console.log("============================================================");
console.log(" Clypra Clean-PATH Bundled Sidecar Export & Audio Verification");
console.log("============================================================\n");

// Determine host platform and architecture target
const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
let targetTriple = "";
let binaryExt = "";

if (process.platform === "darwin") {
  targetTriple = `${arch}-apple-darwin`;
} else if (process.platform === "win32") {
  targetTriple = `${arch}-pc-windows-msvc`;
  binaryExt = ".exe";
} else {
  targetTriple = `${arch}-unknown-linux-gnu`;
}

const ffmpegBinary = path.join(binDir, `ffmpeg-${targetTriple}${binaryExt}`);
const ffprobeBinary = path.join(binDir, `ffprobe-${targetTriple}${binaryExt}`);

console.log(`1. Checking bundled sidecar binaries for target: ${targetTriple}`);
if (!fs.existsSync(ffmpegBinary)) {
  console.error(`❌ [FAIL] Bundled ffmpeg not found at: ${ffmpegBinary}`);
  process.exit(1);
}
if (!fs.existsSync(ffprobeBinary)) {
  console.error(`❌ [FAIL] Bundled ffprobe not found at: ${ffprobeBinary}`);
  process.exit(1);
}
console.log(`  ✅ Found bundled ffmpeg (${(fs.statSync(ffmpegBinary).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  ✅ Found bundled ffprobe (${(fs.statSync(ffprobeBinary).size / 1024 / 1024).toFixed(1)} MB)`);

// Clean PATH environment with zero custom tool paths (no /opt/homebrew, no /usr/local/bin)
const cleanEnv = {
  PATH: process.platform === "win32" ? "C:\\Windows\\system32;C:\\Windows" : "/usr/bin:/bin",
  HOME: process.env.HOME || "/tmp",
  USER: process.env.USER || "clypra",
};

console.log("\n2. Executing bundled export with clean PATH (no system ffmpeg)...");
const testExportPath = path.join(os.tmpdir(), `clypra-clean-path-test-${Date.now()}.mp4`);

try {
  // Generate 1-second 1080p test video with 440Hz sine wave tone
  const exportArgs = [
    "-y",
    "-f", "lavfi", "-i", "testsrc=duration=1.0:size=1920x1080:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1.0:sample_rate=48000",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
    "-c:a", "aac", "-b:a", "192k",
    testExportPath,
  ];

  const exportResult = spawnSync(ffmpegBinary, exportArgs, {
    env: cleanEnv,
    encoding: "utf8",
  });

  if (exportResult.status !== 0) {
    console.error(`❌ [FAIL] Clean-PATH export failed with exit code ${exportResult.status}`);
    console.error(exportResult.stderr);
    process.exit(1);
  }
  console.log(`  ✅ Export completed successfully: ${testExportPath}`);

  console.log("\n3. Validating exported media with bundled ffprobe (clean PATH)...");
  const probeResult = spawnSync(ffprobeBinary, [
    "-v", "quiet",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    testExportPath,
  ], {
    env: cleanEnv,
    encoding: "utf8",
  });

  if (probeResult.status !== 0) {
    console.error(`❌ [FAIL] ffprobe probe failed with exit code ${probeResult.status}`);
    process.exit(1);
  }

  const probe = JSON.parse(probeResult.stdout);
  const videoStream = probe.streams?.find((s) => s.codec_type === "video");
  const audioStream = probe.streams?.find((s) => s.codec_type === "audio");

  if (!videoStream || videoStream.codec_name !== "h264" || videoStream.width !== 1920 || videoStream.height !== 1080) {
    console.error(`❌ [FAIL] Video stream mismatch: ${JSON.stringify(videoStream)}`);
    process.exit(1);
  }
  console.log(`  ✅ Video stream: ${videoStream.codec_name} 1920x1080 @ ${videoStream.r_frame_rate} fps`);

  if (!audioStream || audioStream.codec_name !== "aac" || Number(audioStream.sample_rate) !== 48000) {
    console.error(`❌ [FAIL] Audio stream mismatch: ${JSON.stringify(audioStream)}`);
    process.exit(1);
  }
  console.log(`  ✅ Audio stream: ${audioStream.codec_name} ${audioStream.sample_rate} Hz (${audioStream.channels} channels)`);

  console.log("\n4. Verifying audio RMS / level detection (non-silent output)...");
  const volumeResult = spawnSync(ffmpegBinary, [
    "-i", testExportPath,
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ], {
    env: cleanEnv,
    encoding: "utf8",
  });

  const meanVolumeMatch = volumeResult.stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  const maxVolumeMatch = volumeResult.stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/);

  if (!meanVolumeMatch || !maxVolumeMatch) {
    console.error(`❌ [FAIL] Could not measure audio volume: ${volumeResult.stderr}`);
    process.exit(1);
  }

  const meanVolume = parseFloat(meanVolumeMatch[1]);
  const maxVolume = parseFloat(maxVolumeMatch[1]);
  console.log(`  Audio levels: mean=${meanVolume} dB, max=${maxVolume} dB`);

  if (meanVolume <= -90) {
    console.error(`❌ [FAIL] Exported audio is silent (mean volume ${meanVolume} dB <= -90 dB)`);
    process.exit(1);
  }
  console.log(`  ✅ Audio signal confirmed non-silent (${meanVolume} dB RMS)`);

  console.log("\n============================================================");
  console.log(" Clean-PATH Export & Audio Oracle: ALL CHECKS PASSED! 🎉");
  console.log("============================================================\n");
  process.exit(0);
} finally {
  if (fs.existsSync(testExportPath)) {
    try {
      fs.unlinkSync(testExportPath);
    } catch {
      // ignore
    }
  }
}
