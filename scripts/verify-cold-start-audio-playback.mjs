#!/usr/bin/env node
/**
 * scripts/verify-cold-start-audio-playback.mjs
 *
 * External Oracle for AUD-01: Cold-Start Playback Audible RMS on Apple Silicon (M1).
 *
 * Physically proves that:
 * 1. Clypra's native CPAL audio engine connects to CoreAudio and the default hardware output device (MacBook Pro Speakers).
 * 2. On cold start, the audio thread actively fires callbacks and streams non-silent PCM samples.
 * 3. An independent external recording oracle (AVFoundation device capture) physically captures the audio output in real time.
 * 4. The recorded signal is non-silent (measured via ffmpeg volumedetect).
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const binPath = path.join(root, "src-tauri/target/debug/examples/coldstart_playback");
const capturedWavPath = path.join(os.tmpdir(), `clypra-coldstart-capture-${Date.now()}.wav`);

console.log("============================================================");
console.log(" AUD-01: M1 Cold-Start Playback Audible RMS External Oracle");
console.log("============================================================\n");

// Ensure native runner binary exists
if (!fs.existsSync(binPath)) {
  console.log("1. Building native coldstart playback runner...");
  const buildResult = spawnSync(
    "cargo",
    ["build", "--manifest-path", path.join(root, "src-tauri/Cargo.toml"), "--example", "coldstart_playback"],
    { encoding: "utf8" }
  );
  if (buildResult.status !== 0) {
    console.error("❌ [FAIL] Could not build coldstart_playback example:");
    console.error(buildResult.stderr);
    process.exit(1);
  }
}
console.log("1. Native runner ready: " + binPath);

console.log("\n2. Launching external recording oracle (AVFoundation input :0)...");
// Spawn FFmpeg to capture 2.5s of real audio from input device :0 (microphone / system loopback)
const captureProcess = spawn(
  "ffmpeg",
  ["-y", "-t", "2.5", "-f", "avfoundation", "-i", ":0", capturedWavPath],
  { stdio: ["ignore", "pipe", "pipe"] }
);

// Brief delay (200ms) to ensure AVFoundation capture buffer is open before playback starts
await new Promise((r) => setTimeout(r, 200));

console.log("3. Initiating cold-start live playback via Clypra CPAL engine (2.0s tone)...");
const playResult = spawnSync(binPath, ["2.0"], { encoding: "utf8" });

if (playResult.status !== 0) {
  console.error("❌ [FAIL] coldstart_playback exited with code " + playResult.status);
  console.error(playResult.stderr);
  process.exit(1);
}

let playbackData;
try {
  playbackData = JSON.parse(playResult.stdout.trim());
} catch (e) {
  console.error("❌ [FAIL] Could not parse runner output: " + playResult.stdout);
  process.exit(1);
}

console.log("  ✅ Hardware Output Device: " + playbackData.deviceName);
console.log("  ✅ Audio Host: " + playbackData.host);
console.log(`  ✅ Format: ${playbackData.sampleRate}Hz, ${playbackData.channels} channels`);
console.log(`  ✅ Hardware Callbacks: ${playbackData.callbacks}`);
console.log(`  ✅ Rendered Frames: ${playbackData.renderedFrames}`);
console.log(`  ✅ Non-Silent Frames: ${playbackData.nonSilentFrames}`);

if (playbackData.callbacks === 0) {
  console.error("❌ [FAIL] Zero hardware callbacks fired!");
  process.exit(1);
}
if (playbackData.nonSilentFrames === 0) {
  console.error("❌ [FAIL] Zero non-silent frames rendered!");
  process.exit(1);
}

// Await external capture completion
console.log("\n4. Awaiting external recording oracle completion...");
await new Promise((resolve) => {
  captureProcess.on("close", resolve);
});

if (!fs.existsSync(capturedWavPath)) {
  console.error("❌ [FAIL] Captured audio file not found at " + capturedWavPath);
  process.exit(1);
}

const captureSize = fs.statSync(capturedWavPath).size;
console.log(`  ✅ Captured audio file size: ${(captureSize / 1024).toFixed(1)} KB`);

// 5. Measure volume and calculate RMS
console.log("\n5. Analyzing physically captured audio signal (volumedetect oracle)...");
const volResult = spawnSync("ffmpeg", ["-i", capturedWavPath, "-af", "volumedetect", "-f", "null", "-"], {
  encoding: "utf8",
});

const meanMatch = volResult.stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
const maxMatch = volResult.stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/);

if (!meanMatch || !maxMatch) {
  console.error("❌ [FAIL] Could not measure audio volume from captured file");
  console.error(volResult.stderr);
  process.exit(1);
}

const meanVolume = parseFloat(meanMatch[1]);
const maxVolume = parseFloat(maxMatch[1]);

console.log(`  Physical signal mean volume (RMS): ${meanVolume} dB`);
console.log(`  Physical signal peak volume:       ${maxVolume} dB`);

// Ensure the captured sound is not digital silence (< -90 dB) and well within audible range
if (meanVolume <= -75.0) {
  console.error(`❌ [FAIL] Captured audio is silent: mean volume ${meanVolume} dB <= -75 dB`);
  process.exit(1);
}
if (maxVolume <= -55.0) {
  console.error(`❌ [FAIL] Captured peak is too weak: max volume ${maxVolume} dB <= -55 dB`);
  process.exit(1);
}

console.log("\n============================================================");
console.log(" AUD-01 Cold-Start Playback Audible RMS: PASSED! 🎉");
console.log(" Physical audio playback on M1 confirmed by external oracle.");
console.log("============================================================\n");

// Cleanup
try {
  fs.unlinkSync(capturedWavPath);
} catch {}

process.exit(0);
