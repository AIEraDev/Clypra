#!/usr/bin/env node
/**
 * Opt-in rendering and media-throughput qualification.
 *
 * This deliberately distinguishes:
 *  - FilmCraft CPU-reference vs GPU-compositor parity tests;
 *  - Clypra's real-media decoder throughput measurements;
 *  - full end-to-end playback, which is NOT measured by decode_throughput_bench.
 *
 * Do not report decoder throughput as end-to-end playback FPS.
 */
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessResultCollector } from "./collect-results.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(ROOT);

const FILMCRAFT_REPO = path.resolve(process.env.FILMCRAFT_REPO || path.join(ROOT, "../filmcraft"));
const FIXTURE_DIR = path.resolve(process.env.CLYPRA_GOLDEN_FIXTURES || path.join(ROOT, "fixtures/golden-project"));
const RESULT_DIR = path.resolve(process.env.CLYPRA_PERF_RESULT_DIR || path.join(ROOT, "test-results/render-performance"));
const REPORT_PATH = path.join(ROOT, "test-results/render-performance-acceptance.json");
const FRAMES = positiveInt(process.env.CLYPRA_BENCH_FRAMES, 1800);
const WARMUP = positiveInt(process.env.CLYPRA_BENCH_WARMUP, 60);
const DOWNLOAD_EVERY = positiveInt(process.env.CLYPRA_BENCH_DOWNLOAD_EVERY, 3);
const REQUIRE_HARDWARE = process.env.CLYPRA_PERF_REQUIRE_HARDWARE !== "0";
const REQUIRE_4K60 = process.env.CLYPRA_REQUIRE_4K60 !== "0";
const ENFORCE_REALTIME = process.env.CLYPRA_ENFORCE_REALTIME_DECODE === "1";
const collector = new HarnessResultCollector("Clypra Render & Performance Acceptance");

function positiveInt(value, fallback) {
  const n = Number.parseInt(value || "", 10);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function blocked(message) {
  const error = new Error(message);
  error.blocked = true;
  return error;
}

async function exists(file) {
  try {
    await access(file, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function capture(command, args, options = {}) {
  const cwd = options.cwd || ROOT;
  const timeoutMs = options.timeoutMs || 30 * 60 * 1000;
  const env = options.env || process.env;
  const maxBytes = options.maxBytes || 64 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    let totalBytes = 0;
    let timedOut = false;
    let tooLarge = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    const addChunk = (collection, chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        tooLarge = true;
        child.kill("SIGTERM");
        return;
      }
      collection.push(chunk);
    };

    child.stdout.on("data", chunk => addChunk(stdout, chunk));
    child.stderr.on("data", chunk => addChunk(stderr, chunk));
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const result = {
        code: code ?? 1,
        signal,
        timedOut,
        tooLarge,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (timedOut) {
        reject(new Error("Timed out after " + timeoutMs + "ms: " + command + " " + args.join(" ") + "\n" + result.stderr.slice(-5000)));
      } else if (tooLarge) {
        reject(new Error("Command output exceeded " + maxBytes + " bytes: " + command + " " + args.join(" ")));
      } else {
        resolve(result);
      }
    });
  });
}

function assertCommandSucceeded(result, name) {
  if (result.code !== 0) {
    throw new Error(name + " exited with code " + result.code + (result.signal ? " (" + result.signal + ")" : "") +
      "\nstdout:\n" + result.stdout.slice(-3000) + "\nstderr:\n" + result.stderr.slice(-6000));
  }
}

async function gate(name, category, action) {
  const started = Date.now();
  try {
    const value = await action();
    const detail = typeof value === "string" ? value : (value?.details || "");
    const artifacts = typeof value === "object" && value !== null ? (value.artifacts || []) : [];
    collector.record({ name, category, status: "PASSED", durationMs: Date.now() - started, details: detail, artifacts });
    console.log("✓ [" + category + "] " + name);
    if (detail) console.log("  " + detail);
    return { ok: true, value };
  } catch (error) {
    const status = error?.blocked ? "BLOCKED" : "FAILED";
    collector.record({
      name,
      category,
      status,
      durationMs: Date.now() - started,
      exitCode: 1,
      details: error?.stack || String(error),
    });
    console.error((status === "BLOCKED" ? "○" : "✗") + " [" + category + "] " + name + ": " + (error?.message || error));
    return { ok: false, error };
  }
}

function summarizeCargoTests(output) {
  const summaries = [...output.matchAll(/test result:\s*ok\.\s*(\d+)\s+passed;\s*(\d+)\s+failed;/g)];
  if (summaries.length === 0) throw new Error("Cargo completed without a recognizable successful test summary.");
  const passed = summaries.reduce((sum, match) => sum + Number(match[1]), 0);
  const failed = summaries.reduce((sum, match) => sum + Number(match[2]), 0);
  if (passed === 0 || failed !== 0) throw new Error("Unexpected Cargo test summary: " + passed + " passed, " + failed + " failed.");
  return passed + " Rust tests passed across " + summaries.length + " test binaries.";
}

async function runCargoTests(args, label, options = {}) {
  const cargo = process.env.CARGO_BIN || "cargo";
  const result = await capture(cargo, args, {
    cwd: options.cwd || FILMCRAFT_REPO,
    timeoutMs: options.timeoutMs || 30 * 60 * 1000,
    maxBytes: 64 * 1024 * 1024,
  });
  assertCommandSucceeded(result, label);
  const combined = result.stdout + "\n" + result.stderr;
  const summary = summarizeCargoTests(combined);
  if (options.requireGpu && /no GPU adapter;\s*skipping|skipping:\s*GPU hardware unavailable|GPU hardware unavailable/i.test(combined)) {
    throw blocked("One or more GPU parity tests skipped because no usable wgpu adapter was available. Cargo's exit code alone is not sufficient for GPU qualification.");
  }
  return summary;
}

async function runCpuGpuParity() {
  const manifest = path.join(FILMCRAFT_REPO, "Cargo.toml");
  if (!(await exists(manifest))) {
    throw blocked("FilmCraft workspace not found at " + FILMCRAFT_REPO + ". Set FILMCRAFT_REPO to the FilmCraft checkout.");
  }
  const cpu = await runCargoTests(["test", "--manifest-path", manifest, "-p", "filmcraft-render", "--lib"], "FilmCraft CPU reference renderer tests");
  const gpu = await runCargoTests(
    ["test", "--manifest-path", manifest, "-p", "filmcraft-gpu", "--lib", "--", "--nocapture", "--test-threads=1"],
    "FilmCraft GPU parity tests",
    { requireGpu: true },
  );
  return cpu + " CPU reference; " + gpu + " GPU compositor. GPU tests that skipped for lack of an adapter are reported BLOCKED, not green.";
}

function expectedMedia(kind) {
  if (kind === "1080p60") return { width: 1920, height: 1080, minFps: 59.0, label: "1080p60 H.264" };
  if (kind === "4k30") return { width: 3840, height: 2160, minFps: 29.0, maxFps: 31.0, label: "4K30 HEVC" };
  return { width: 3840, height: 2160, minFps: 59.0, label: "4K60 source" };
}

function getFixture(kind) {
  if (kind === "1080p60") {
    return path.resolve(process.env.CLYPRA_BENCH_1080P60 || path.join(FIXTURE_DIR, "video_1080p_60fps_h264.mp4"));
  }
  if (kind === "4k30") {
    return path.resolve(process.env.CLYPRA_BENCH_4K30 || path.join(FIXTURE_DIR, "video_4k_30fps_hevc.mp4"));
  }
  return process.env.CLYPRA_BENCH_4K60 ? path.resolve(process.env.CLYPRA_BENCH_4K60) : null;
}

async function decoderBench(kind, file) {
  if (!(await exists(file))) throw blocked(expectedMedia(kind).label + " fixture not found: " + file);
  const fileInfo = await stat(file);
  if (!fileInfo.isFile() || fileInfo.size === 0) throw new Error("Media fixture is empty or not a file: " + file);

  await mkdir(RESULT_DIR, { recursive: true });
  const outputPath = path.join(RESULT_DIR, kind + ".json");
  await rm(outputPath, { force: true });
  const args = [
    "run", "--release", "--manifest-path", path.join(ROOT, "src-tauri/Cargo.toml"),
    "--example", "decode-throughput-bench", "--",
    "--video", file,
    "--frames", String(FRAMES),
    "--warmup", String(WARMUP),
    "--download-every", String(DOWNLOAD_EVERY),
    "--arms", "0,1,2,2b",
    "--output", outputPath,
  ];

  const env = { ...process.env };
  const localFfmpeg = path.join(ROOT, "src-tauri/ffmpeg-static");
  if (!env.FFMPEG_DIR && await exists(path.join(localFfmpeg, "include/libavutil/avutil.h"))) {
    env.FFMPEG_DIR = localFfmpeg;
  }

  const result = await capture(env.CARGO_BIN || "cargo", args, {
    cwd: ROOT,
    env,
    timeoutMs: 45 * 60 * 1000,
    maxBytes: 64 * 1024 * 1024,
  });
  assertCommandSucceeded(result, kind + " Clypra decoder throughput benchmark");

  if (!(await exists(outputPath))) throw new Error("Benchmark command did not create JSON report: " + outputPath);
  let report;
  try {
    report = JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    throw new Error("Benchmark report is not valid JSON: " + error.message);
  }

  if (report.build_profile !== "release") throw new Error("Performance report must come from a release build.");
  const spec = expectedMedia(kind);
  if (report.clip_width !== spec.width || report.clip_height !== spec.height) {
    throw new Error("Wrong fixture dimensions for " + kind + ": got " + report.clip_width + "x" + report.clip_height +
      ", expected " + spec.width + "x" + spec.height + ".");
  }
  if (!Number.isFinite(report.clip_fps) || report.clip_fps < spec.minFps ||
      (spec.maxFps && report.clip_fps > spec.maxFps)) {
    throw new Error("Wrong source frame rate for " + kind + ": got " + report.clip_fps + " fps.");
  }

  const arms = new Map((report.arms || []).map(arm => [String(arm.arm), arm]));
  for (const armId of ["0", "1", "2", "2b"]) {
    const arm = arms.get(armId);
    if (!arm) throw new Error("Benchmark report lacks arm " + armId + ".");
    if (!arm.implemented || !arm.valid || arm.error || !Number.isFinite(arm.sustained_fps) || arm.frames_measured === 0) {
      throw new Error("Benchmark arm " + armId + " is invalid: " + JSON.stringify(arm));
    }
  }

  const hardwareArm = arms.get("1");
  if (REQUIRE_HARDWARE && !hardwareArm.hw_accelerated) {
    throw blocked("Benchmark ran, but this source did not use hardware acceleration (arm 1). Result JSON was retained at " +
      path.relative(ROOT, outputPath) + ". Use a supported hardware/media combination or set CLYPRA_PERF_REQUIRE_HARDWARE=0 to collect software-path data.");
  }

  const fpsMet = hardwareArm.sustained_fps >= report.clip_fps;
  if (ENFORCE_REALTIME && !fpsMet) {
    throw new Error("Hardware decode throughput " + hardwareArm.sustained_fps.toFixed(2) +
      " fps is below the source cadence " + report.clip_fps.toFixed(2) + " fps.");
  }

  const formatArm = id => {
    const arm = arms.get(id);
    return "arm " + id + "=" + arm.sustained_fps.toFixed(2) + " fps (p95 " +
      (arm.frame_time_p95_us == null ? "n/a" : (arm.frame_time_p95_us / 1000).toFixed(2) + " ms") +
      (arm.hw_accelerated ? ", hardware " + (arm.hw_device_type || "yes") : ", software/fallback") + ")";
  };
  const details = spec.label + " " + report.clip_width + "x" + report.clip_height + " @ " +
    report.clip_fps.toFixed(3) + " source fps; " + FRAMES + " measured frames. " +
    [formatArm("0"), formatArm("1"), formatArm("2"), formatArm("2b")].join("; ") +
    ". Real-time decode target " + (fpsMet ? "met" : "not met") + (ENFORCE_REALTIME ? " (enforced)." : " (reported only; set CLYPRA_ENFORCE_REALTIME_DECODE=1 to enforce).");
  return { details, artifacts: [path.relative(ROOT, outputPath)] };
}

async function main() {
  await gate("FilmCraft CPU reference + GPU compositor parity", "Pillar 2: Rendering", runCpuGpuParity);

  const specs = [
    { kind: "1080p60", required: true },
    { kind: "4k30", required: true },
    { kind: "4k60", required: REQUIRE_4K60 },
  ];

  for (const spec of specs) {
    const fixture = getFixture(spec.kind);
    if (!fixture && !spec.required) {
      collector.record({
        name: "4K60 source throughput qualification",
        category: "Pillar 3: Throughput",
        status: "SKIPPED",
        durationMs: 0,
        details: "CLYPRA_BENCH_4K60 was not supplied. Existing golden media has 4K30, which cannot qualify a 4K60 source target.",
      });
      console.log("○ [Pillar 3: Throughput] 4K60 qualification skipped by explicit configuration.");
      continue;
    }
    if (!fixture) {
      await gate("4K60 source throughput qualification", "Pillar 3: Throughput", async () => {
        throw blocked("No 4K60 media fixture is present in the current golden corpus (it contains 4K30 HEVC). Set CLYPRA_BENCH_4K60 to a real 3840x2160 source with at least 59 fps.");
      });
      continue;
    }
    await gate(expectedMedia(spec.kind).label + " decoder throughput", "Pillar 3: Throughput", () => decoderBench(spec.kind, fixture));
  }

  if (process.env.CLYPRA_DECODE_ONLY === "1") {
    collector.record({
      name: "End-to-end playback qualification boundary",
      category: "Pillar 3: Playback",
      status: "SKIPPED",
      durationMs: 0,
      details: "Decode-only characterization was explicitly requested. This result is not a full playback qualification and must not gate migration of the primary desktop timeline.",
    });
    console.log("○ [Pillar 3: Playback] End-to-end qualification skipped by explicit decode-only mode.");
  } else {
    await gate("End-to-end playback qualification boundary", "Pillar 3: Playback", async () => {
      throw blocked(
        "The existing decode-throughput-bench measures real decoder throughput and transfer cost, not the complete native preview loop. It does not measure timeline scheduling, GPU composition of decoded frames, native surface presentation deadlines, audio-master clock drift, or dropped visible frames. Full playback qualification remains open; do not treat decoder throughput as end-to-end 4K60 playback proof. Set CLYPRA_DECODE_ONLY=1 only for decoder characterization, not release qualification.",
      );
    });
  }

  const passed = collector.printSummary();
  await collector.saveJsonReport(path.relative(ROOT, REPORT_PATH));
  if (!passed) process.exitCode = 1;
}

main().catch(async error => {
  console.error("Fatal render/performance acceptance harness error:", error);
  collector.record({
    name: "Harness startup",
    category: "Harness",
    status: "FAILED",
    durationMs: 0,
    exitCode: 1,
    details: error?.stack || String(error),
  });
  collector.printSummary();
  await collector.saveJsonReport(path.relative(ROOT, REPORT_PATH));
  process.exitCode = 1;
});
