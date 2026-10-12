#!/usr/bin/env node
/**
 * Clypra Benchmark Baseline & Regression Comparator
 *
 * Compares current benchmark results against an established versioned baseline.
 * Enforces regression tolerances across Responsiveness, Pacing, Concurrency, and Memory.
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
    console.error(`❌ Current benchmark results file not found at: ${currentPath}`);
    console.error(`Run 'node scripts/benchmarks/run-playback-concurrency-harness.mjs' first.`);
    process.exit(1);
  }

  const currentJson = JSON.parse(await readFile(currentPath, "utf8"));

  // If no baseline exists or --update-baseline requested, establish current as baseline
  if (!existsSync(baselinePath) || updateBaseline) {
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, JSON.stringify(currentJson, null, 2), "utf8");
    console.log(`📌 Established current benchmark run as canonical baseline at:`);
    console.log(`   ${baselinePath}\n`);
    console.log(`Verdict: [ BASELINE ESTABLISHED (NO REGRESSION) ]\n`);
    process.exit(0);
  }

  const baselineJson = JSON.parse(await readFile(baselinePath, "utf8"));
  console.log(`Comparing current run against baseline:`);
  console.log(`  Current : ${currentJson.timestamp} (${currentJson.host})`);
  console.log(`  Baseline: ${baselineJson.timestamp} (${baselineJson.host})\n`);

  const metricsToCompare = [];

  // Extract scenario A metrics
  if (currentJson.scenarios?.scenarioA && baselineJson.scenarios?.scenarioA) {
    const curA = currentJson.scenarios.scenarioA.metrics;
    const baseA = baselineJson.scenarios.scenarioA.metrics;

    metricsToCompare.push({
      name: "TTFF Latency (ms)",
      base: baseA.ttffMs,
      curr: curA.ttffMs,
      maxAllowedDeltaPct: 25.0,
      lowerBetter: true,
    });
    metricsToCompare.push({
      name: "Cold Seek P95 (ms)",
      base: baseA.coldSeekP95Ms,
      curr: curA.coldSeekP95Ms,
      maxAllowedDeltaPct: 25.0,
      lowerBetter: true,
    });
    metricsToCompare.push({
      name: "Warm Seek P95 (ms)",
      base: baseA.warmSeekP95Ms,
      curr: curA.warmSeekP95Ms,
      maxAllowedDeltaPct: 25.0,
      lowerBetter: true,
    });
    metricsToCompare.push({
      name: "Scrub P95 (ms)",
      base: baseA.scrubP95Ms,
      curr: curA.scrubP95Ms,
      maxAllowedDeltaPct: 20.0,
      lowerBetter: true,
    });
    metricsToCompare.push({
      name: "Dropped Frames",
      base: baseA.droppedFrameCount,
      curr: curA.droppedFrameCount,
      maxAllowedDeltaVal: 2,
      lowerBetter: true,
    });
  }

  // Extract scenario B metrics
  if (currentJson.scenarios?.scenarioB && baselineJson.scenarios?.scenarioB) {
    const curB = currentJson.scenarios.scenarioB.metrics;
    const baseB = baselineJson.scenarios.scenarioB.metrics;

    metricsToCompare.push({
      name: "Playback P95 Under Load (ms)",
      base: baseB.playbackP95UnderLoadMs,
      curr: curB.playbackP95UnderLoadMs,
      maxAllowedDeltaPct: 25.0,
      lowerBetter: true,
    });
  }

  // Extract scenario D metrics
  if (currentJson.scenarios?.scenarioD && baselineJson.scenarios?.scenarioD) {
    const curD = currentJson.scenarios.scenarioD.metrics;
    const baseD = baselineJson.scenarios.scenarioD.metrics;

    metricsToCompare.push({
      name: "Soak Heap Delta (MB)",
      base: baseD.heapDeltaMb,
      curr: curD.heapDeltaMb,
      maxAllowedDeltaVal: 20.0,
      lowerBetter: true,
    });
    metricsToCompare.push({
      name: "Orphaned Processes",
      base: baseD.orphanedProcesses,
      curr: curD.orphanedProcesses,
      maxAllowedDeltaVal: 0,
      lowerBetter: true,
    });
  }

  console.log("------------------------------------------------------------------------------------------------");
  console.log("Metric                          | Baseline   | Current    | Delta      | Status");
  console.log("--------------------------------+------------+------------+------------+------------------------");

  let criticalRegressions = 0;
  let advisoryWarnings = 0;

  for (const m of metricsToCompare) {
    const name = m.name.padEnd(31);
    const baseStr = `${m.base}`.padStart(10);
    const currStr = `${m.curr}`.padStart(10);

    let deltaPct = 0;
    if (m.base > 0) {
      deltaPct = ((m.curr - m.base) / m.base) * 100;
    }

    const deltaSign = deltaPct > 0 ? `+${deltaPct.toFixed(1)}%` : `${deltaPct.toFixed(1)}%`;
    const deltaStr = (m.base === 0 && m.curr === 0 ? "0.0%" : deltaSign).padStart(10);

    let status = "✓ STABLE";
    let isRegressed = false;

    if (m.maxAllowedDeltaVal !== undefined) {
      if (m.curr > m.base + m.maxAllowedDeltaVal) {
        status = "✗ CRITICAL REGRESSION";
        isRegressed = true;
      }
    } else if (m.maxAllowedDeltaPct !== undefined) {
      // Noise floor: Sub-15ms differences represent cloud runner VM scheduling noise,
      // not real architectural regressions (budgets are 15ms - 50ms).
      const noiseFloor = m.noiseFloor ?? 15.0;
      if (deltaPct > m.maxAllowedDeltaPct && m.curr > noiseFloor) {
        status = "✗ REGRESSION";
        isRegressed = true;
      } else if (deltaPct > 10.0 && m.curr > noiseFloor) {
        status = "⚠️ ADVISORY WARNING";
        advisoryWarnings++;
      }
    }

    if (isRegressed) {
      criticalRegressions++;
    }

    console.log(`${name} | ${baseStr} | ${currStr} | ${deltaStr} | ${status}`);
  }

  console.log("------------------------------------------------------------------------------------------------\n");

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
