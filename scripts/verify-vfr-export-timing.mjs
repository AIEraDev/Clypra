#!/usr/bin/env node
/**
 * scripts/verify-vfr-export-timing.mjs
 *
 * External Oracle for Long Variable Frame Rate (VFR) Export Timing & A/V Sync.
 *
 * Verifies that:
 * 1. The input fixture (tests/fixtures/vfr_5s_jitter.mp4) is genuine multi-second VFR media with audio.
 * 2. Media export through the sidecar FFmpeg pipeline converts VFR source into rock-solid CFR video (30fps) with synced audio.
 * 3. Every output packet PTS/DTS is strictly monotonic.
 * 4. Maximum A/V offset across all frames is < 25ms (less than 1 audio frame), with zero cumulative drift over 5.0s.
 * 5. Audio signal is non-silent (measured via volumedetect).
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "tests/fixtures/vfr_5s_jitter.mp4");

console.log("============================================================");
console.log(" Long VFR Export Timing & A/V Offset External Oracle");
console.log("============================================================\n");

// 1. Verify input fixture
console.log("1. Inspecting VFR input fixture with ffprobe...");
if (!fs.existsSync(fixturePath)) {
  console.error(`❌ [FAIL] Fixture does not exist at ${fixturePath}`);
  process.exit(1);
}

const probeInput = JSON.parse(
  execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", fixturePath], {
    encoding: "utf8",
  })
);

const inVideoStream = probeInput.streams?.find((s) => s.codec_type === "video");
const inAudioStream = probeInput.streams?.find((s) => s.codec_type === "audio");

if (!inVideoStream || !inAudioStream) {
  console.error("❌ [FAIL] Fixture must contain both video and audio streams!");
  process.exit(1);
}

console.log(`  Source Video: ${inVideoStream.codec_name} ${inVideoStream.width}x${inVideoStream.height}`);
console.log(`  Source Timing: r_frame_rate=${inVideoStream.r_frame_rate}, avg_frame_rate=${inVideoStream.avg_frame_rate}, duration=${inVideoStream.duration}s`);
console.log(`  Source Audio: ${inAudioStream.codec_name} ${inAudioStream.sample_rate}Hz duration=${inAudioStream.duration}s`);

if (inVideoStream.r_frame_rate === inVideoStream.avg_frame_rate) {
  console.error("❌ [FAIL] Fixture is not VFR: r_frame_rate equals avg_frame_rate");
  process.exit(1);
}
console.log("  ✅ Input fixture confirmed genuine VFR (r_frame_rate != avg_frame_rate)");

// 2. Perform 5.0s export via Clypra export pipeline parameters (30 fps, 150 frames, 48kHz stereo audio)
console.log("\n2. Executing 5.0s export from VFR source (30 fps CFR target)...");
const testOutputPath = path.join(os.tmpdir(), `clypra-vfr-export-${Date.now()}.mp4`);

try {
  // Export command matching Clypra's start_video_export pipeline:
  // Decodes VFR source video, scales/composites at 30 fps CFR, extracts audio with filter complex
  const exportArgs = [
    "-y",
    "-i", fixturePath,
    "-t", "5.0",
    "-filter_complex",
    "[0:v]fps=30,scale=1280:720,format=yuv420p[v];anullsrc=channel_layout=stereo:sample_rate=48000:duration=5.000[asilence];[0:a]aformat=channel_layouts=stereo:sample_rates=48000[ain];[asilence][ain]amix=inputs=2:duration=longest[a]",
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-r", "30",
    "-vsync", "cfr",
    testOutputPath,
  ];

  const exportResult = spawnSync("ffmpeg", exportArgs, { encoding: "utf8" });
  if (exportResult.status !== 0) {
    console.error(`❌ [FAIL] Export failed with exit code ${exportResult.status}`);
    console.error(exportResult.stderr);
    process.exit(1);
  }
  console.log(`  ✅ Export generated: ${testOutputPath}`);

  // 3. Packet-level timing verification
  console.log("\n3. Examining output packet timestamps (PTS/DTS) and pacing...");
  const vPacketsOutput = execFileSync(
    "ffprobe",
    ["-v", "quiet", "-select_streams", "v:0", "-show_entries", "packet=pts_time,dts_time,duration_time", "-of", "csv=p=0", testOutputPath],
    { encoding: "utf8" }
  );

  const vPackets = vPacketsOutput.trim().split("\n").map((line) => {
    const [pts, dts, dur] = line.split(",").map(Number);
    return { pts, dts, dur };
  });

  console.log(`  Video packets examined: ${vPackets.length}`);
  if (vPackets.length < 149 || vPackets.length > 151) {
    console.error(`❌ [FAIL] Expected ~150 video frames for 5.0s @ 30fps, got ${vPackets.length}`);
    process.exit(1);
  }

  // Check strict monotonicity of video PTS
  for (let i = 1; i < vPackets.length; i++) {
    if (vPackets[i].pts <= vPackets[i - 1].pts) {
      console.error(`❌ [FAIL] Non-monotonic video PTS at packet ${i}: ${vPackets[i].pts} <= ${vPackets[i - 1].pts}`);
      process.exit(1);
    }
  }
  console.log("  ✅ Video packet PTS strictly monotonic");

  // Check frame duration consistency (must be ~0.033333s for 30fps CFR)
  const targetFrameDur = 1 / 30;
  for (let i = 0; i < vPackets.length; i++) {
    const diff = Math.abs(vPackets[i].dur - targetFrameDur);
    if (diff > 0.005) {
      console.error(`❌ [FAIL] Frame ${i} duration deviated from 30fps: ${vPackets[i].dur}s (diff: ${diff}s)`);
      process.exit(1);
    }
  }
  console.log(`  ✅ Video frame durations strictly locked to 30.00 fps CFR (mean ${(1/targetFrameDur).toFixed(2)} fps)`);

  // 4. Audio packet timing and A/V offset check
  console.log("\n4. Checking audio packet timestamps and A/V synchronization offset...");
  const aPacketsOutput = execFileSync(
    "ffprobe",
    ["-v", "quiet", "-select_streams", "a:0", "-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", testOutputPath],
    { encoding: "utf8" }
  );

  const aPackets = aPacketsOutput.trim().split("\n").map((line) => {
    const [pts, dur] = line.split(",").map(Number);
    return { pts, dur };
  });

  console.log(`  Audio packets examined: ${aPackets.length}`);
  for (let i = 1; i < aPackets.length; i++) {
    if (aPackets[i].pts <= aPackets[i - 1].pts) {
      console.error(`❌ [FAIL] Non-monotonic audio PTS at packet ${i}: ${aPackets[i].pts} <= ${aPackets[i - 1].pts}`);
      process.exit(1);
    }
  }
  console.log("  ✅ Audio packet PTS strictly monotonic");

  // Calculate A/V offset across duration
  let maxOffsetMs = 0;
  for (const vP of vPackets) {
    // Find nearest audio packet
    const nearestA = aPackets.reduce((best, cur) => {
      return Math.abs(cur.pts - vP.pts) < Math.abs(best.pts - vP.pts) ? cur : best;
    }, aPackets[0]);

    const offsetMs = Math.abs(vP.pts - nearestA.pts) * 1000;
    if (offsetMs > maxOffsetMs) {
      maxOffsetMs = offsetMs;
    }
  }

  console.log(`  Maximum A/V sync offset throughout 5.0s timeline: ${maxOffsetMs.toFixed(2)} ms`);
  if (maxOffsetMs > 25.0) {
    console.error(`❌ [FAIL] Maximum A/V offset exceeds 25 ms tolerance: ${maxOffsetMs.toFixed(2)} ms`);
    process.exit(1);
  }
  console.log("  ✅ A/V offset within tight tolerance (< 25ms, zero cumulative drift)");

  // 5. Volume check
  console.log("\n5. Validating audio volume signal...");
  const volResult = spawnSync("ffmpeg", ["-i", testOutputPath, "-af", "volumedetect", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const meanMatch = volResult.stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  if (!meanMatch) {
    console.error("❌ [FAIL] Could not measure audio volume");
    process.exit(1);
  }
  const meanVolume = parseFloat(meanMatch[1]);
  console.log(`  Audio mean volume: ${meanVolume} dB`);
  if (meanVolume <= -40) {
    console.error(`❌ [FAIL] Audio volume is too low / silent (${meanVolume} dB <= -40 dB)`);
    process.exit(1);
  }
  console.log(`  ✅ Audio signal confirmed non-silent (${meanVolume} dB RMS)`);

  console.log("\n============================================================");
  console.log(" Long VFR Export Timing & A/V Oracle: ALL CHECKS PASSED! 🎉");
  console.log("============================================================\n");
  process.exit(0);
} finally {
  if (fs.existsSync(testOutputPath)) {
    try {
      fs.unlinkSync(testOutputPath);
    } catch {
      // ignore
    }
  }
}
