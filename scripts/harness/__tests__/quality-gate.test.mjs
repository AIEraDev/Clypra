/**
 * Clypra Quality Gate & Regression Comparator Deterministic Test Suite
 *
 * Verifies non-negotiable quality gate enforcement:
 *   1. Deliberately regressed metrics produce exit code 1 and "REGRESSION DETECTED (BLOCK)"
 *   2. Missing baselines produce exit code 1 and "BLOCKED (MISSING_BASELINE)"
 *   3. Zero-valued (0.00 ms) or negative latency measurements produce exit code 1 and "INVALID_MEASUREMENT (BLOCK)"
 *   4. Compliant measurements produce exit code 0 and "NO REGRESSION (PASS)"
 *   5. Updating baseline establishes complete provenance (commit, hardware profile, fixture hashes)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "../../..");
const SCRIPT_PATH = resolve(REPO_ROOT, "scripts/benchmarks/compare-baseline.mjs");
const TMP_DIR = resolve(REPO_ROOT, "test-results/tmp-quality-gate-tests");

function createMockReport(overrides = {}) {
  return {
    suite: "Clypra Playback & Concurrency Quality Harness",
    timestamp: new Date().toISOString(),
    host: "darwin (arm64)",
    provenance: {
      gitCommit: "abc1234567890",
      gitBranch: "test/quality-gate",
      hostPlatform: "darwin",
      hostArch: "arm64",
      cpuModel: "Apple M1",
      cpuCores: 8,
      totalMemoryGb: 16,
      fixtureHashes: {
        "video_1080p_60fps_h264.mp4": "mock_hash_1080p",
        "video_4k_30fps_hevc.mp4": "mock_hash_4k",
        "audio_music_stereo_48k.mp3": "mock_hash_audio",
      },
    },
    microbenchmarks: {
      category: "Microbenchmark",
      timelineMathP95Ms: 0.002,
      samplesEvaluated: 100,
      status: "PASSED",
    },
    scenarios: {
      scenarioA: {
        name: "Interactive Playback & Real Media Decoding",
        status: "PASSED",
        metrics: {
          ttffMs: 140.0,
          coldSeekP95Ms: 180.0,
          warmSeekP95Ms: 1.5,
          scrubP95Ms: 175.0,
          droppedFrameCount: 0,
          droppedFrameRatio: 0.0,
          avSyncDriftMs: 23.0,
        },
      },
      scenarioB: {
        name: "Concurrent Workloads & Subsystem Contention",
        status: "PASSED",
        metrics: {
          playbackP95UnderLoadMs: 400.0,
          backgroundTasksCompleted: 6,
          avgWaveformExtractionMs: 80.0,
        },
      },
      scenarioC: {
        name: "Reliability & Stress Recovery",
        status: "PASSED",
        metrics: {
          rapidSeekErrors: 0,
          cancellationErrors: 0,
          missingMediaHandledGracefully: true,
        },
      },
      scenarioD: {
        name: "Long-Duration Stability & Soak",
        status: "PASSED",
        metrics: {
          soakFramesEvaluated: 150,
          heapDeltaMb: 0.4,
          orphanedProcesses: 0,
        },
      },
      scenarioE: {
        name: "Golden Project Media Export Pipeline",
        status: "PASSED",
        metrics: {
          exportDurationSec: 1.8,
          rtf: 5.5,
          faststart: true,
          sampleRate: 48000,
        },
      },
    },
    ...overrides,
  };
}

describe("Quality Gate & Baseline Regression Comparator Tests", () => {
  before(async () => {
    await mkdir(TMP_DIR, { recursive: true });
  });

  after(async () => {
    try {
      await rm(TMP_DIR, { recursive: true, force: true });
    } catch {}
  });

  test("1. Deliberately regressed metric causes FAIL / BLOCK with exit code 1", async () => {
    const baseFile = resolve(TMP_DIR, "base-1.json");
    const currFile = resolve(TMP_DIR, "curr-1.json");

    const baseReport = createMockReport();
    // Current report has a +100% regression on cold seek latency
    const currReport = createMockReport();
    currReport.scenarios.scenarioA.metrics.coldSeekP95Ms = 380.0; // from 180ms to 380ms (+111%)

    await writeFile(baseFile, JSON.stringify(baseReport, null, 2), "utf8");
    await writeFile(currFile, JSON.stringify(currReport, null, 2), "utf8");

    try {
      await execFileAsync("node", [SCRIPT_PATH, "--current", currFile, "--baseline", baseFile]);
      assert.fail("Comparator should have failed with exit code 1");
    } catch (err) {
      assert.equal(err.code, 1);
      assert.match(err.stdout, /REGRESSION DETECTED \(BLOCK\)/);
      assert.match(err.stdout, /Cold Seek P95 \(ms\)/);
    }
  });

  test("2. Missing baseline without --update-baseline causes BLOCKED with exit code 1", async () => {
    const currFile = resolve(TMP_DIR, "curr-2.json");
    const nonExistentBase = resolve(TMP_DIR, "non-existent-base-2.json");

    await writeFile(currFile, JSON.stringify(createMockReport(), null, 2), "utf8");

    try {
      await execFileAsync("node", [SCRIPT_PATH, "--current", currFile, "--baseline", nonExistentBase]);
      assert.fail("Comparator should have failed when baseline does not exist");
    } catch (err) {
      assert.equal(err.code, 1);
      const combined = (err.stdout || "") + (err.stderr || "");
      assert.match(combined, /BLOCKED \(MISSING_BASELINE\)/);
      assert.match(combined, /forbid unverified branches from self-certifying/);
    }
  });

  test("3. Zero-valued (0.00 ms) synchronous simulated latency is rejected with exit code 1", async () => {
    const baseFile = resolve(TMP_DIR, "base-3.json");
    const currFile = resolve(TMP_DIR, "curr-3.json");

    const baseReport = createMockReport();
    // Stale synchronous 0.00ms latency sample
    const currReport = createMockReport();
    currReport.scenarios.scenarioA.metrics.warmSeekP95Ms = 0.00;

    await writeFile(baseFile, JSON.stringify(baseReport, null, 2), "utf8");
    await writeFile(currFile, JSON.stringify(currReport, null, 2), "utf8");

    try {
      await execFileAsync("node", [SCRIPT_PATH, "--current", currFile, "--baseline", baseFile]);
      assert.fail("Comparator should have rejected 0.00 ms latency");
    } catch (err) {
      assert.equal(err.code, 1);
      assert.match(err.stdout, /INVALID_MEASUREMENT \(BLOCK\)/);
      assert.match(err.stdout, /INVALID \(NON-POSITIVE SAMPLE\)/);
      assert.match(err.stdout, /forbid 0\.00ms synchronous simulated latencies/);
    }
  });

  test("4. Compliant run against valid baseline produces PASS with exit code 0", async () => {
    const baseFile = resolve(TMP_DIR, "base-4.json");
    const currFile = resolve(TMP_DIR, "curr-4.json");

    const baseReport = createMockReport();
    const currReport = createMockReport();
    // Small normal variance within 2%
    currReport.scenarios.scenarioA.metrics.coldSeekP95Ms = 182.0;

    await writeFile(baseFile, JSON.stringify(baseReport, null, 2), "utf8");
    await writeFile(currFile, JSON.stringify(currReport, null, 2), "utf8");

    const { stdout } = await execFileAsync("node", [SCRIPT_PATH, "--current", currFile, "--baseline", baseFile]);
    assert.match(stdout, /FINAL COMPARISON VERDICT: \[ NO REGRESSION \(PASS\) \]/);
    assert.match(stdout, /Regressions: 0/);
  });

  test("5. Updating baseline establishes provenance record with exit code 0", async () => {
    const currFile = resolve(TMP_DIR, "curr-5.json");
    const targetBase = resolve(TMP_DIR, "established-base-5.json");

    await writeFile(currFile, JSON.stringify(createMockReport(), null, 2), "utf8");

    const { stdout } = await execFileAsync("node", [
      SCRIPT_PATH,
      "--current", currFile,
      "--baseline", targetBase,
      "--update-baseline",
    ]);

    assert.match(stdout, /Established current benchmark run as canonical baseline/);
    assert.match(stdout, /Baseline Provenance Record:/);
    assert.match(stdout, /3 verified SHA-256 hashes/);
    assert.match(stdout, /BASELINE ESTABLISHED \(NO REGRESSION\)/);
  });
});
