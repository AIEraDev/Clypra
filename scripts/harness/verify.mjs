import { spawn } from "node:child_process";
import { HarnessResultCollector } from "./collect-results.mjs";

const args = process.argv.slice(2);
const collector = new HarnessResultCollector("Clypra Verification Harness");

// Determine which modes were requested
const hasFlag = (flag) => args.includes(flag);
const runAll = args.length === 0 || hasFlag("--full");
const doFast = runAll || hasFlag("--fast");
const doArchitecture = runAll || hasFlag("--architecture") || doFast;
const doIntegration = runAll || hasFlag("--integration");
const doUi = runAll || hasFlag("--ui");
const doDesktop = runAll || hasFlag("--desktop");
const doMedia = runAll || hasFlag("--media");
const doChanged = hasFlag("--changed");

async function executeCommand(name, category, cmd, cmdArgs = [], env = {}) {
  const start = Date.now();
  console.log(`\n▶️ [${category}] Running: ${name} (${cmd} ${cmdArgs.join(" ")})`);

  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, ...env },
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - start;
      const status = code === 0 ? "PASSED" : "FAILED";
      collector.record({
        name,
        category,
        status,
        durationMs,
        exitCode: code ?? 1,
        details: code !== 0 ? `Process exited with code ${code}` : "",
      });
      resolve(code === 0);
    });

    child.on("error", (err) => {
      const durationMs = Date.now() - start;
      collector.record({
        name,
        category,
        status: "FAILED",
        durationMs,
        exitCode: 1,
        details: err.message,
      });
      resolve(false);
    });
  });
}

async function main() {
  console.log("🚀 Starting Clypra Verification Runner...\n");
  let overallSuccess = true;

  // ── 1. Architecture Checks ────────────────────────────────────────────────
  if (doArchitecture) {
    const ok = await executeCommand(
      "Architectural Invariants & Parity",
      "Architecture",
      "node",
      ["scripts/harness/check-architecture.mjs"],
    );
    if (!ok) overallSuccess = false;
  }

  // ── 2. Fast Static Analysis & Unit Suite ──────────────────────────────────
  if (doFast) {
    const tscOk = await executeCommand(
      "TypeScript Strict Typecheck",
      "Static Analysis",
      "npx",
      ["tsc", "--noEmit"],
    );
    if (!tscOk) overallSuccess = false;

    const previewOk = await executeCommand(
      "Preview Render Loop Suite (156 Tests)",
      "Unit Tests",
      "npx",
      ["vitest", "run", "src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts"],
    );
    if (!previewOk) overallSuccess = false;
  }

  // ── 3. Changed Files Targeted Testing ──────────────────────────────────────
  if (doChanged) {
    const changedOk = await executeCommand(
      "Changed Files Vitest Suite",
      "Targeted Tests",
      "npx",
      ["vitest", "run", "--changed"],
    );
    if (!changedOk) overallSuccess = false;
  }

  // ── 4. Subsystem Integration Suite ─────────────────────────────────────────
  if (doIntegration) {
    const integrationOk = await executeCommand(
      "Subsystem & Audio Integration Suite",
      "Integration",
      "npx",
      [
        "vitest",
        "run",
        "src/core/audio/__tests__/nativeAudioTimeline.test.ts",
        "src/core/media/__tests__/mediaAudioDetection.test.ts",
      ],
    );
    if (!integrationOk) overallSuccess = false;
  }

  // ── 5. Media & NLE Domain Suite ───────────────────────────────────────────
  if (doMedia) {
    const mediaOk = await executeCommand(
      "Media Timeline & Evaluation Regressions",
      "Media Engine",
      "npx",
      [
        "vitest",
        "run",
        "src/core/timeline/__tests__/audioClipsExportRangeFades.test.ts",
        "src/core/evaluation/__tests__/mediaTimelineRegression.test.ts",
      ],
    );
    if (!mediaOk) overallSuccess = false;
  }

  // ── 6. Frontend Browser E2E UI Suite (Playwright) ──────────────────────────
  if (doUi) {
    const uiOk = await executeCommand(
      "Playwright Frontend UI Workflows",
      "Browser UI E2E",
      "npx",
      ["playwright", "test"],
    );
    if (!uiOk) overallSuccess = false;
  }

  // ── 7. Desktop Native Packaging & Smoke Suite ──────────────────────────────
  if (doDesktop) {
    const desktopOk = await executeCommand(
      "Packaged Application Bundle Smoke Test",
      "Native Desktop",
      "node",
      ["scripts/smoke-test-packaged-app.mjs"],
    );
    if (!desktopOk) overallSuccess = false;
  }

  // ── Results & Reporting ───────────────────────────────────────────────────
  const allPassed = collector.printSummary();
  await collector.saveJsonReport();

  if (!overallSuccess || !allPassed) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal verification error:", err);
  process.exit(1);
});
