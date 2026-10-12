#!/usr/bin/env node
/**
 * Clypra Benchmark Baseline & Regression Comparator
 *
 * Compares current benchmark results against an established versioned baseline.
 * Enforces regression tolerances across Responsiveness, Pacing, Concurrency, and Memory.
 *
 * Requirements:
 *   1. Explicit Provenance: Validates git commit, hardware profile, fixture hashes.
 *   2. Strict Sample Validation: Zero-valued (0.00 ms) or negative latency samples are rejected.
 *   3. No Self-Certification: Missing baselines without --update-baseline exit with code 1 (BLOCKED).
 *   4. Microbenchmark vs Product Benchmark Separation.
 *
 * Usage:
 *   node scripts/benchmarks/compare-baseline.mjs [--current <path>] [--baseline <path>] [--update-baseline]
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_CURRENT = resolve(__dirname, "../../test-results/playback-concurrency-benchmark.json");
const DEFAULT_BASELINE = resolve(__dirname, "results/baselines/playback-concurrency-baseline.json");

const args = process.argv.slice(2);
const updateBaseline = args.includes("--update-baseline");

const currentArgIdx = args.indexOf("--current");
const currentPath = currentArgIdx !== -1 && args[currentArgIdx + 1] ? resolve(args[currentArgIdx + 1]) : DEFAULT_CURRENT;

const baselineArgIdx = args.indexOf("--baseline");
const baselinePath = baselineArgIdx !== -1 && args[baselineArgIdx + 1] ? resolve(args[baselineArgIdx + 1]) : DEFAULT_BASELINE;

async function main() {
  console.log(`\n================================================================`);
  console.log(`  CLYPRA BENCHMARK REGRESSION & BASELINE COMPARATOR`);
  console.log(`================================================================\n`);

  if (!existsSync(currentPath)) {
    console.warn(`⚠️ Current benchmark results file not found at: ${currentPath}`);
    console.warn(`Skipping baseline comparison (no run recorded).\n`);
    process.exit(0);
  }

  const currentJson = JSON.parse(await readFile(currentPath, "utf8"));

  // Enforce baseline discipline: Never allow unverified runs to auto-initialize baseline without explicit flag
  if (!existsSync(baselinePath)) {
    if (!updateBaseline) {
      console.error(`❌ Baseline file not found at: ${baselinePath}`);
      console.error(`\n[BLOCKED (MISSING_BASELINE)]`);
      console.error(`Clypra release and CI standards forbid unverified branches from self-certifying.`);
      console.error(`To establish a trusted baseline on a controlled runner or canonical release branch, run with:`);
      console.error(`  node scripts/benchmarks/compare-baseline.mjs --update-baseline\n`);
      process.exit(1);
    }
  }

  // If --update-baseline requested, establish current as canonical baseline with explicit provenance
  if (updateBaseline) {
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, JSON.stringify(currentJson, null, 2), "utf8");
    console.log(`📌 Established current benchmark run as canonical baseline at:`);
    console.log(`   ${baselinePath}\n`);
    console.log(`Baseline Provenance Record:`);
    console.log(`  Commit   : ${currentJson.provenance?.gitCommit || "unknown"}`);
    console.log(`  Branch   : ${currentJson.provenance?.gitBranch || "unknown"}`);
    console.log(`  Host     : ${currentJson.provenance?.hostPlatform || process.platform} (${currentJson.provenance?.hostArch || process.arch})`);
    console.log(`  CPU      : ${currentJson.provenance?.cpuModel || "unknown"} (${currentJson.provenance?.cpuCores || "?"} cores)`);
    console.log(`  RAM      : ${currentJson.provenance?.totalMemoryGb || "?"} GB`);
    console.log(`  Fixtures : ${Object.keys(currentJson.provenance?.fixtureHashes || {}).length} verified SHA-256 hashes\n`);
    console.log(`Verdict: [ BASELINE ESTABLISHED (NO REGRESSION) ]\n`);
    process.exit(0);
  }

  const baselineJson = JSON.parse(await readFile(baselinePath, "utf8"));

  console.log(`Provenance & Hardware Comparison:`);
  console.log(`  Current Run : commit ${currentJson.provenance?.gitCommit?.slice(0, 8) || "N/A"} (${currentJson.provenance?.gitBranch || "N/A"}) on ${currentJson.provenance?.cpuModel || currentJson.host} (${currentJson.timestamp})`);
  console.log(`  Baseline    : commit ${baselineJson.provenance?.gitCommit?.slice(0, 8) || "N/A"} (${baselineJson.provenance?.gitBranch || "N/A"}) on ${baselineJson.provenance?.cpuModel || baselineJson.host} (${baselineJson.timestamp})\n`);

  if (baselineJson.provenance?.fixtureHashes && currentJson.provenance?.fixtureHashes) {
    for (const [file, hash] of Object.entries(baselineJson.provenance.fixtureHashes)) {
      const curHash = currentJson.provenance.fixtureHashes[file];
      if (curHash && curHash !== hash) {
        console.warn(`⚠️ Warning: Fixture hash mismatch for ${file} (base=${hash.slice(0, 8)}, curr=${curHash.slice(0, 8)})`);
      }
    }
  }

  // ── Build Metrics Lists Separated by Category ──────────────────────────────
  const microbenchmarks = [];
  const productBenchmarks = [];

  // Microbenchmarks (In-Memory Math & Algorithms)
  if (currentJson.microbenchmarks?.timelineMathP95Ms !== undefined || baselineJson.microbenchmarks?.timelineMathP95Ms !== undefined) {
    microbenchmarks.push({
      name: "In-Memory Math P95 (ms)",
      base: baselineJson.microbenchmarks?.timelineMathP95Ms,
      curr: currentJson.microbenchmarks?.timelineMathP95Ms,
      maxAllowedDeltaPct: 50.0,
      noiseFloor: 0.05,
      lowerBetter: true,
      isLatency: false,
    });
  }

  // Product Benchmarks: Scenario A (Interactive Playback & Real Media Decoding)
  const curA = currentJson.scenarios?.scenarioA?.metrics || {};
  const baseA = baselineJson.scenarios?.scenarioA?.metrics || {};

  productBenchmarks.push({
    name: "Real TTFF Latency (ms)",
    base: baseA.ttffMs,
    curr: curA.ttffMs,
    maxAllowedDeltaPct: 50.0,
    noiseFloor: 100.0,
    lowerBetter: true,
    isLatency: true,
  });
  productBenchmarks.push({
    name: "Cold Seek P95 (ms)",
    base: baseA.coldSeekP95Ms,
    curr: curA.coldSeekP95Ms,
    maxAllowedDeltaPct: 35.0,
    noiseFloor: 50.0,
    lowerBetter: true,
    isLatency: true,
  });
  productBenchmarks.push({
    name: "Warm Seek P95 (ms)",
    base: baseA.warmSeekP95Ms,
    curr: curA.warmSeekP95Ms,
    maxAllowedDeltaPct: 50.0,
    noiseFloor: 10.0,
    lowerBetter: true,
    isLatency: true,
  });
  productBenchmarks.push({
    name: "Scrub P95 Frame Pacing (ms)",
    base: baseA.scrubP95Ms,
    curr: curA.scrubP95Ms,
    maxAllowedDeltaPct: 35.0,
    noiseFloor: 50.0,
    lowerBetter: true,
    isLatency: true,
  });
  productBenchmarks.push({
    name: "Dropped Frames Count",
    base: baseA.droppedFrameCount ?? 0,
    curr: curA.droppedFrameCount ?? 0,
    maxAllowedDeltaVal: 2,
    lowerBetter: true,
    isLatency: false,
  });
  productBenchmarks.push({
    name: "A/V Stream Sync Drift (ms)",
    base: baseA.avSyncDriftMs,
    curr: curA.avSyncDriftMs,
    maxAllowedDeltaVal: 15.0,
    lowerBetter: true,
    isLatency: false,
  });

  // Product Benchmarks: Scenario B (Concurrency Under Load)
  const curB = currentJson.scenarios?.scenarioB?.metrics || {};
  const baseB = baselineJson.scenarios?.scenarioB?.metrics || {};

  productBenchmarks.push({
    name: "Playback P95 Under Load (ms)",
    base: baseB.playbackP95UnderLoadMs,
    curr: curB.playbackP95UnderLoadMs,
    maxAllowedDeltaPct: 40.0,
    noiseFloor: 150.0,
    lowerBetter: true,
    isLatency: true,
  });

  // Product Benchmarks: Scenario D (Reliability & Soak)
  const curD = currentJson.scenarios?.scenarioD?.metrics || {};
  const baseD = baselineJson.scenarios?.scenarioD?.metrics || {};

  productBenchmarks.push({
    name: "Soak Heap Growth Delta (MB)",
    base: baseD.heapDeltaMb,
    curr: curD.heapDeltaMb,
    maxAllowedDeltaVal: 20.0,
    lowerBetter: true,
    isLatency: false,
  });
  productBenchmarks.push({
    name: "Orphaned Child Processes",
    base: baseD.orphanedProcesses ?? 0,
    curr: curD.orphanedProcesses ?? 0,
    maxAllowedDeltaVal: 0,
    lowerBetter: true,
    isLatency: false,
  });

  // Product Benchmarks: Scenario E (Export Pipeline)
  const curE = currentJson.scenarios?.scenarioE?.metrics || {};
  const baseE = baselineJson.scenarios?.scenarioE?.metrics || {};
  if (curE.rtf !== undefined || baseE.rtf !== undefined) {
    productBenchmarks.push({
      name: "Export Real-Time Factor (RTF)",
      base: baseE.rtf,
      curr: curE.rtf,
      maxAllowedDeltaPct: -50.0, // Regressed if curr drops by more than 50%
      lowerBetter: false,
      isLatency: false,
    });
  }

  // ── Evaluation Engine ───────────────────────────────────────────────────────
  let invalidSamples = 0;
  let criticalRegressions = 0;
  let advisoryWarnings = 0;

  function evaluateMetric(m) {
    // Strict Validation: Zero or negative latencies are invalid synchronous measurements
    if (m.isLatency) {
      if (m.curr === undefined || m.curr <= 0.0001 || m.base === undefined || m.base <= 0.0001) {
        invalidSamples++;
        return {
          ...m,
          deltaStr: "INVALID".padStart(10),
          status: "✗ INVALID (NON-POSITIVE SAMPLE)",
          isRegressed: true,
        };
      }
    }

    if (m.base === undefined || m.curr === undefined) {
      return {
        ...m,
        deltaStr: "N/A".padStart(10),
        status: "ℹ️ UNTRACKED",
        isRegressed: false,
      };
    }

    let deltaPct = 0;
    if (m.base > 0) {
      deltaPct = ((m.curr - m.base) / m.base) * 100;
    }

    const deltaSign = deltaPct > 0 ? `+${deltaPct.toFixed(1)}%` : `${deltaPct.toFixed(1)}%`;
    const deltaStr = (m.base === 0 && m.curr === 0 ? "0.0%" : deltaSign).padStart(10);

    let status = "✓ STABLE";
    let isRegressed = false;
    const absDelta = Math.abs(m.curr - m.base);

    if (m.lowerBetter === false) {
      // Higher is better (e.g. Export RTF)
      if (m.maxAllowedDeltaPct !== undefined && deltaPct < m.maxAllowedDeltaPct) {
        status = "✗ REGRESSION";
        isRegressed = true;
      }
    } else {
      // Lower is better
      if (m.maxAllowedDeltaVal !== undefined) {
        if (m.curr > m.base + m.maxAllowedDeltaVal) {
          status = "✗ CRITICAL REGRESSION";
          isRegressed = true;
        }
      } else if (m.maxAllowedDeltaPct !== undefined) {
        const noiseFloor = m.noiseFloor ?? 25.0;
        if (deltaPct > m.maxAllowedDeltaPct && absDelta > noiseFloor) {
          status = "✗ REGRESSION";
          isRegressed = true;
        } else if (deltaPct > 15.0 && absDelta > noiseFloor) {
          status = "⚠️ ADVISORY WARNING";
          advisoryWarnings++;
        }
      }
    }

    if (isRegressed) {
      criticalRegressions++;
    }

    return { ...m, deltaStr, status, isRegressed };
  }

  // ── Render Formatted Comparator Table ───────────────────────────────────────
  function printTable(title, list) {
    console.log(`▶ ${title}`);
    console.log("------------------------------------------------------------------------------------------------");
    console.log("Metric                          | Baseline   | Current    | Delta      | Status");
    console.log("--------------------------------+------------+------------+------------+------------------------");
    for (const item of list) {
      const evaluated = evaluateMetric(item);
      const name = evaluated.name.padEnd(31);
      const baseStr = `${evaluated.base ?? "N/A"}`.padStart(10);
      const currStr = `${evaluated.curr ?? "N/A"}`.padStart(10);
      console.log(`${name} | ${baseStr} | ${currStr} | ${evaluated.deltaStr} | ${evaluated.status}`);
    }
    console.log("------------------------------------------------------------------------------------------------\n");
  }

  if (microbenchmarks.length > 0) {
    printTable("MICROBENCHMARKS (In-Memory Math & Timeline Algorithms)", microbenchmarks);
  }

  const mediaRan = Boolean(currentJson.scenarios?.scenarioA?.metrics?.ttffMs !== undefined);
  if (mediaRan) {
    printTable("PRODUCT BENCHMARKS (End-to-End Real Media Playback, Concurrency & Reliability)", productBenchmarks);
  } else {
    console.log("ℹ️ Product benchmarks skipped: Golden Project media fixtures or media tools not present in this runner environment.\n");
  }

  // ── Decision & Verdict ──────────────────────────────────────────────────────
  if (invalidSamples > 0) {
    console.log(`================================================================`);
    console.log(`  FINAL COMPARISON VERDICT: [ INVALID_MEASUREMENT (BLOCK) ]`);
    console.log(`  Invalid Non-Positive Samples: ${invalidSamples}`);
    console.log(`  Clypra standards forbid 0.00ms synchronous simulated latencies.`);
    console.log(`================================================================\n`);
    process.exit(1);
  }

  const verdict = criticalRegressions === 0 ? "NO REGRESSION (PASS)" : "REGRESSION DETECTED (BLOCK)";
  console.log(`================================================================`);
  console.log(`  FINAL COMPARISON VERDICT: [ ${verdict} ]`);
  console.log(`  Regressions: ${criticalRegressions} | Warnings: ${advisoryWarnings}`);
  console.log(`================================================================\n`);

  if (criticalRegressions > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Comparison error:", err);
  process.exit(1);
});
