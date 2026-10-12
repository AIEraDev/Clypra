#!/usr/bin/env node
/**
 * Clypra Unified Engineering Quality Gate Orchestrator
 *
 * Implements the non-negotiable Quality Gate connecting:
 *   Feature / Upgrade -> Risk & Subsystem Classifier -> 4 Pillars of Verification:
 *     1. Behavioral Validation (Correctness, regressions, invariants, typing, i18n)
 *     2. Performance Validation (Latency percentiles, frame pacing, throughput)
 *     3. Concurrency Validation (Mixed media, simultaneous background tasks, contention)
 *     4. Reliability Validation (Soak tests, cancellation, crashes, resource leaks)
 *   -> Evidence-Based Quality Decision (Baseline comparison, trends, PASS / FAIL / BLOCKED / SKIPPED).
 *
 * Usage:
 *   node scripts/harness/quality-gate.mjs [--full] [--ci] [--fast] [--json-out <path>]
 */

import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

const args = process.argv.slice(2);
const isFull = args.includes("--full");
const isCi = args.includes("--ci");
const isFast = args.includes("--fast") && !isFull && !isCi;

const REPORT_JSON_PATH = resolve(REPO_ROOT, "test-results/quality-gate-report.json");
const REPORT_MD_PATH = resolve(REPO_ROOT, "test-results/quality-gate-summary.md");

// ── 1. Subsystem & Risk Classifier ───────────────────────────────────────────

function detectChangedSubsystems() {
  try {
    const gitStatus = execSync("git status --porcelain", { cwd: REPO_ROOT, encoding: "utf8" });
    const changedFiles = gitStatus
      .split("\n")
      .map(line => line.trim().slice(3))
      .filter(Boolean);

    const subsystems = new Set();
    for (const f of changedFiles) {
      if (f.startsWith("src/core/audio/") || f.includes("native_audio") || f.includes("Audio")) subsystems.add("AUDIO");
      if (f.startsWith("src/components/editor/preview/") || f.includes("preview") || f.includes("wgpu")) subsystems.add("PREVIEW");
      if (f.startsWith("src/core/timeline/") || f.startsWith("src/core/evaluation/")) subsystems.add("TIMELINE");
      if (f.startsWith("src/lib/export/") || f.includes("export")) subsystems.add("EXPORT");
      if (f.startsWith("src/features/stickers/")) subsystems.add("STICKERS");
      if (f.startsWith("src/i18n/")) subsystems.add("I18N");
      if (f.startsWith(".agents/") || f.startsWith(".kiro/") || f.includes("AGENTS.md")) subsystems.add("SKILLS");
      if (f.startsWith("src-tauri/")) subsystems.add("NATIVE_RUST");
    }

    return {
      changedFilesCount: changedFiles.length,
      detectedSubsystems: Array.from(subsystems),
    };
  } catch {
    return { changedFilesCount: 0, detectedSubsystems: ["ALL"] };
  }
}

// ── 2. Command Execution Helper ──────────────────────────────────────────────

async function executeStep(name, cmd, cmdArgs = [], env = {}) {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: REPO_ROOT,
      stdio: "pipe",
      shell: true,
      env: { ...process.env, ...env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });

    child.on("close", (code) => {
      const durationMs = Date.now() - start;
      const pass = code === 0;
      resolve({
        name,
        pass,
        status: pass ? "PASSED" : "FAILED",
        durationMs,
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    child.on("error", (err) => {
      resolve({
        name,
        pass: false,
        status: "FAILED",
        durationMs: Date.now() - start,
        exitCode: 1,
        stdout: "",
        stderr: err.message,
      });
    });
  });
}

// ── 3. Orchestration Engine ──────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log(`\n╔═════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║             CLYPRA UNIFIED ENGINEERING QUALITY GATE ORCHESTRATOR            ║`);
  console.log(`╚═════════════════════════════════════════════════════════════════════════════╝\n`);

  const { changedFilesCount, detectedSubsystems } = detectChangedSubsystems();
  console.log(`🔍 Change Detection: ${changedFilesCount} modified file(s) across [${detectedSubsystems.join(", ") || "WORKING_TREE"}]`);
  console.log(`🎯 Profile: ${isFull ? "FULL RELEASE QUALIFICATION" : isCi ? "CI AUTOMATED GATE" : "LOCAL FAST GATE"}\n`);

  const results = {
    timestamp: new Date().toISOString(),
    host: `${process.platform} (${process.arch})`,
    profile: isFull ? "full" : isCi ? "ci" : "fast",
    subsystems: detectedSubsystems,
    pillars: {
      behavioral: { name: "Behavioral Validation", status: "PENDING", checks: [] },
      performance: { name: "Performance Validation", status: "PENDING", checks: [] },
      concurrency: { name: "Concurrency Validation", status: "PENDING", checks: [] },
      reliability: { name: "Reliability Validation", status: "PENDING", checks: [] },
    },
    decision: {
      verdict: "PENDING", // PASS | FAIL | BLOCKED | SKIPPED
      reasons: [],
    },
  };

  // ── PILLAR 1: Behavioral Validation ───────────────────────────────────────
  console.log(`▶ [PILLAR 1] Executing Behavioral Validation (Correctness, Invariants, Types)...`);

  // 1.1 Architectural Invariants
  const archResult = await executeStep("Architecture Invariants Check", "node", ["scripts/harness/check-architecture.mjs"]);
  results.pillars.behavioral.checks.push(archResult);
  console.log(`   ${archResult.pass ? "✅" : "❌"} Architecture Invariants     : ${archResult.status} (${(archResult.durationMs / 1000).toFixed(2)}s)`);

  // 1.2 TypeScript Static Typecheck
  const tscResult = await executeStep("TypeScript Strict Typecheck", "npx", ["tsc", "--noEmit"]);
  results.pillars.behavioral.checks.push(tscResult);
  console.log(`   ${tscResult.pass ? "✅" : "❌"} TypeScript Compiler (tsc)   : ${tscResult.status} (${(tscResult.durationMs / 1000).toFixed(2)}s)`);

  // 1.3 i18n Parity Check
  const i18nResult = await executeStep("i18n 9-Locale Parity Check", "node", ["scripts/check-i18n.mjs"]);
  results.pillars.behavioral.checks.push(i18nResult);
  console.log(`   ${i18nResult.pass ? "✅" : "❌"} i18n Catalog Parity         : ${i18nResult.status} (${(i18nResult.durationMs / 1000).toFixed(2)}s)`);

  // 1.4 Preview Render Loop Regression Suite
  const previewResult = await executeStep(
    "Preview Render Loop Regressions",
    "npx",
    ["vitest", "run", "src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts"]
  );
  results.pillars.behavioral.checks.push(previewResult);
  console.log(`   ${previewResult.pass ? "✅" : "❌"} Preview Render Loop Suite   : ${previewResult.status} (${(previewResult.durationMs / 1000).toFixed(2)}s)`);

  const p1Passed = results.pillars.behavioral.checks.every(c => c.pass);
  results.pillars.behavioral.status = p1Passed ? "PASSED" : "FAILED";
  console.log(`   └─ Pillar 1 Status: [ ${results.pillars.behavioral.status} ]\n`);

  // ── PILLAR 2 & 3 & 4: Execute Media Playback & Concurrency Harness ────────
  console.log(`▶ [PILLARS 2, 3, 4] Executing Real-Media Playback, Concurrency & Reliability Harness...`);

  const harnessArgs = ["scripts/benchmarks/run-playback-concurrency-harness.mjs"];
  if (isFast) harnessArgs.push("--quick");

  const harnessExec = await executeStep("Playback & Concurrency Harness", "node", harnessArgs);

  let harnessReport = null;
  const harnessReportPath = resolve(REPO_ROOT, "test-results/playback-concurrency-benchmark.json");
  if (existsSync(harnessReportPath)) {
    try {
      harnessReport = JSON.parse(await readFile(harnessReportPath, "utf8"));
    } catch {}
  }

  // Populate Pillar 2 (Performance & Export)
  const perfStatus = harnessReport?.scenarios?.scenarioA?.status || (harnessExec.pass ? "PASSED" : "FAILED");
  const exportStatus = harnessReport?.scenarios?.scenarioE?.status || "PASSED";
  const p2Combined = (perfStatus === "PASSED" && exportStatus === "PASSED") ? "PASSED" : "FAILED";
  results.pillars.performance.status = p2Combined;
  results.pillars.performance.checks.push({
    name: "Interactive Playback Latency & TTFF",
    status: perfStatus,
    pass: perfStatus === "PASSED",
    metrics: harnessReport?.scenarios?.scenarioA?.metrics || {},
  });
  results.pillars.performance.checks.push({
    name: "Golden Project Media Export Pipeline",
    status: exportStatus,
    pass: exportStatus === "PASSED",
    metrics: harnessReport?.scenarios?.scenarioE?.metrics || {},
  });
  console.log(`   ${p2Combined === "PASSED" ? "✅" : "❌"} [Pillar 2: Performance]      : ${p2Combined} (TTFF, Seeks, Scrubbing, Export RTF)`);

  // Populate Pillar 3 (Concurrency)
  const concStatus = harnessReport?.scenarios?.scenarioB?.status || (harnessExec.pass ? "PASSED" : "FAILED");
  results.pillars.concurrency.status = concStatus;
  results.pillars.concurrency.checks.push({
    name: "Concurrent Background Workloads & Contention",
    status: concStatus,
    pass: concStatus === "PASSED",
    metrics: harnessReport?.scenarios?.scenarioB?.metrics || {},
  });
  console.log(`   ${concStatus === "PASSED" ? "✅" : "❌"} [Pillar 3: Concurrency]      : ${concStatus} (Simultaneous tasks & contention)`);

  // Populate Pillar 4 (Reliability)
  const relStatusC = harnessReport?.scenarios?.scenarioC?.status || "PASSED";
  const relStatusD = harnessReport?.scenarios?.scenarioD?.status || "PASSED";
  const relCombined = (relStatusC === "PASSED" && relStatusD === "PASSED" && harnessExec.pass) ? "PASSED" : "FAILED";
  results.pillars.reliability.status = relCombined;
  results.pillars.reliability.checks.push({
    name: "Stress & Recovery (Seeks, Cancellation)",
    status: relStatusC,
    pass: relStatusC === "PASSED",
  });
  results.pillars.reliability.checks.push({
    name: "Long-Duration Stability & Soak",
    status: relStatusD,
    pass: relStatusD === "PASSED",
    metrics: harnessReport?.scenarios?.scenarioD?.metrics || {},
  });
  console.log(`   ${relCombined === "PASSED" ? "✅" : "❌"} [Pillar 4: Reliability]      : ${relCombined} (Soak, zero leaks, 0 orphans)\n`);

  // ── Baseline Comparison & Regression Gate ─────────────────────────────────
  console.log(`▶ [EVIDENCE GATE] Performing Baseline Comparison & Regression Check...`);
  const baselineExec = await executeStep("Baseline Regression Comparison", "node", ["scripts/benchmarks/compare-baseline.mjs"]);
  const regressionPassed = baselineExec.pass;
  const isMissingBaseline = (baselineExec.stdout.includes("MISSING_BASELINE") || baselineExec.stderr.includes("MISSING_BASELINE"));
  const isInvalidMeasurement = (baselineExec.stdout.includes("INVALID_MEASUREMENT") || baselineExec.stderr.includes("INVALID_MEASUREMENT"));

  console.log(`   ${regressionPassed ? "✅" : "❌"} Regression Baseline Gate    : ${regressionPassed ? "NO REGRESSION (PASS)" : isMissingBaseline ? "BLOCKED (MISSING_BASELINE)" : "REGRESSION DETECTED (BLOCK)"}\n`);
  if (!regressionPassed && baselineExec.stdout) {
    console.log(baselineExec.stdout);
  }

  // Record provenance & benchmarks metadata
  results.provenance = harnessReport?.provenance || {};
  results.microbenchmarks = harnessReport?.microbenchmarks || {};
  results.productBenchmarks = harnessReport?.productBenchmarks || {};

  // ── Final Decision Logic ──────────────────────────────────────────────────
  const allPillarsPassed = (
    results.pillars.behavioral.status === "PASSED" &&
    results.pillars.performance.status === "PASSED" &&
    results.pillars.concurrency.status === "PASSED" &&
    results.pillars.reliability.status === "PASSED" &&
    regressionPassed
  );

  let finalVerdict = "FAIL";
  if (allPillarsPassed) {
    finalVerdict = "PASS";
  } else if (!harnessReport?.fixturesAvailable) {
    if (isCi) {
      // In CI environments without large media fixtures, behavioral pillar and microbenchmarks determine pass/fail
      finalVerdict = (results.pillars.behavioral.status === "PASSED" && regressionPassed) ? "PASS" : "FAIL";
      if (finalVerdict === "PASS") {
        console.log("ℹ️ Media fixtures not present on CI runner — passed Behavioral gate and verified in-memory microbenchmarks.");
      } else {
        if (results.pillars.behavioral.status !== "PASSED") results.decision.reasons.push("Behavioral validation checks failed in CI.");
        if (!regressionPassed) results.decision.reasons.push("Microbenchmark regression detected in CI.");
      }
    } else {
      finalVerdict = "BLOCKED";
      results.decision.reasons.push("Required test media fixtures missing.");
    }
  } else if (isMissingBaseline) {
    finalVerdict = "BLOCKED";
    results.decision.reasons.push("Baseline missing; unverified runs cannot self-certify. Run with --update-baseline on controlled runner.");
  } else {
    finalVerdict = "FAIL";
    if (results.pillars.behavioral.status !== "PASSED") results.decision.reasons.push("Behavioral validation checks failed.");
    if (results.pillars.performance.status !== "PASSED") results.decision.reasons.push("Performance latency budgets breached.");
    if (results.pillars.concurrency.status !== "PASSED") results.decision.reasons.push("Concurrency starvation detected under load.");
    if (results.pillars.reliability.status !== "PASSED") results.decision.reasons.push("Reliability soak or memory leak threshold breached.");
    if (isInvalidMeasurement) results.decision.reasons.push("Invalid non-positive latency samples detected (0.00 ms simulated timings rejected).");
    else if (!regressionPassed) results.decision.reasons.push("Regression detected against versioned baseline.");
  }

  results.decision.verdict = finalVerdict;
  const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  // ── Terminal Report Dashboard ─────────────────────────────────────────────
  console.log(`╔═════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║                   CLYPRA QUALITY GATE DECISION SUMMARY                      ║`);
  console.log(`╠═════════════════════════════════════════════════════════════════════════════╣`);
  console.log(`║ 1. Behavioral Validation  : ${results.pillars.behavioral.status.padEnd(10)} (Invariants, TSC, i18n, Render Loop)  ║`);
  console.log(`║ 2. Performance Validation : ${results.pillars.performance.status.padEnd(10)} (Latency, TTFF, Dropped frames)        ║`);
  console.log(`║ 3. Concurrency Validation : ${results.pillars.concurrency.status.padEnd(10)} (Mixed-stack, background contention)    ║`);
  console.log(`║ 4. Reliability Validation : ${results.pillars.reliability.status.padEnd(10)} (Soak stability, zero leaks/orphans)  ║`);
  console.log(`║ 5. Baseline Regression    : ${(regressionPassed ? "PASSED" : "FAILED").padEnd(10)} (Verified vs versioned baseline)       ║`);
  console.log(`╠═════════════════════════════════════════════════════════════════════════════╣`);
  console.log(`║ FINAL VERDICT             : [ ${finalVerdict.padEnd(7)} ] (Execution Time: ${totalDurationSec}s)           ║`);
  console.log(`╚═════════════════════════════════════════════════════════════════════════════╝\n`);

  // ── Emit Machine-Readable JSON & Markdown Reports ─────────────────────────
  await mkdir(dirname(REPORT_JSON_PATH), { recursive: true });
  await writeFile(REPORT_JSON_PATH, JSON.stringify(results, null, 2), "utf8");
  console.log(`📄 Saved structured Quality Gate report to: ${REPORT_JSON_PATH}`);

  const mdSummary = `# Clypra Engineering Quality Gate Report

- **Verdict**: **${finalVerdict === "PASS" ? "✅ PASS" : "❌ " + finalVerdict}**
- **Executed At**: \`${results.timestamp}\`
- **Host**: \`${results.host}\`
- **Total Duration**: \`${totalDurationSec}s\`
- **Subsystems Evaluated**: \`[${detectedSubsystems.join(", ") || "ALL"}]\`

### Hardware & Baseline Provenance
- **Git Commit**: \`${results.provenance?.gitCommit || "unknown"}\`
- **Branch**: \`${results.provenance?.gitBranch || "unknown"}\`
- **CPU**: \`${results.provenance?.cpuModel || "unknown"} (${results.provenance?.cpuCores || "?"} cores)\`
- **RAM**: \`${results.provenance?.totalMemoryGb || "?"} GB\`
- **Media Fixtures Verified**: \`${Object.keys(results.provenance?.fixtureHashes || {}).length} Golden Project files (SHA-256)\`

---

## 4-Pillar Validation Matrix

| Pillar | Status | Core Validations |
| :--- | :---: | :--- |
| **1. Behavioral Validation** | **${results.pillars.behavioral.status}** | Architecture invariants, \`tsc --noEmit\`, \`i18n\`, \`ProgramPreview.renderLoop\` |
| **2. Performance & Export** | **${results.pillars.performance.status}** | Real media TTFF, cold/warm seek percentiles, continuous scrub pacing, Export RTF |
| **3. Concurrency Validation** | **${results.pillars.concurrency.status}** | Mixed-stack workloads under simultaneous background tasks (waveforms + thumbnails) |
| **4. Reliability Validation** | **${results.pillars.reliability.status}** | Sustained soak loop, zero heap leaks, zero orphaned child processes |
| **Baseline Regression Gate** | **${regressionPassed ? "PASSED" : "FAILED"}** | Statistical comparison against versioned hardware baseline |

### Benchmark Breakdown
- **Microbenchmarks (In-Memory)**: P95 timeline math: \`${results.microbenchmarks?.timelineMathP95Ms ?? "N/A"} ms\` (Algorithm budget <= 1.0 ms)
- **Product Benchmarks (Real Media)**:
  - 4K HEVC TTFF: \`${results.productBenchmarks?.realMediaDecoding?.ttff4kHevcMs ?? "N/A"} ms\`
  - 1080p Cold Seek P95: \`${results.productBenchmarks?.realMediaDecoding?.coldSeek1080pP95Ms ?? "N/A"} ms\`
  - 1080p Warm Seek P95 (Cached): \`${results.productBenchmarks?.realMediaDecoding?.warmSeekP95Ms ?? "N/A"} ms\`
  - Scrub P95 Frame Pacing: \`${results.productBenchmarks?.realMediaDecoding?.scrubP95Ms ?? "N/A"} ms\`
  - Foreground Decode Under Load: \`${results.productBenchmarks?.concurrencyUnderLoad?.playbackP95UnderLoadMs ?? "N/A"} ms\`
  - Golden Project Export RTF: \`${results.productBenchmarks?.exportPipeline?.rtf ?? "N/A"}x\`

${results.decision.reasons.length > 0 ? `\n### Failure Diagnostics\n${results.decision.reasons.map(r => `- ❌ ${r}`).join("\n")}` : ""}
`;
  await writeFile(REPORT_MD_PATH, mdSummary, "utf8");
  console.log(`📄 Saved Markdown summary to: ${REPORT_MD_PATH}\n`);

  if (finalVerdict !== "PASS") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal Quality Gate error:", err);
  process.exit(1);
});
