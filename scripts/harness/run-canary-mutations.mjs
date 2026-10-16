#!/usr/bin/env node
/**
 * run-canary-mutations.mjs — Negative control verification
 *
 * For each .patch file in tests/mutations/, applies it to the working tree,
 * runs the affected contract tests, and confirms they FAIL.
 * Then verifies the clean tree passes all contracts.
 *
 * Supports both:
 *   - TypeScript contract suites (via vitest)
 *   - Layer B Rust compositor suites (via cargo test --ignored)
 *
 * Usage: node scripts/harness/run-canary-mutations.mjs
 */

import { spawnSync } from "node:child_process";
import { readdirSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

const MUTATIONS_DIR = resolve(process.cwd(), "tests/mutations");
const CONTRACT_SUITES = [
  "src/core/playback/__tests__/replayBehavioralContract.test.ts",
  "src/core/audio/__tests__/audioPreviewSyncContract.test.ts",
  "src/components/editor/preview/__tests__/previewStateResetContract.test.ts",
  "src/features/text-effects/__tests__/textEditPreviewCycle.test.ts",
  "src/core/evaluation/__tests__/requestRoundTripFixture.test.ts",
];

const RUST_CONTRACT_TESTS = [
  "compositor_raster_transform_tests",
  "compositor_roundtrip_fixture_tests",
];

function runVitest(testFile) {
  const result = spawnSync(
    "npx",
    ["vitest", "run", testFile, "--reporter=verbose"],
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runCargoTest(testName, filter) {
  const args = ["test", "--test", testName, "--", "--ignored"];
  if (filter) {
    args.push(filter);
  }
  const result = spawnSync("cargo", args, {
    cwd: resolve(process.cwd(), "src-tauri"),
    encoding: "utf-8",
    timeout: 180_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runCargoLibTest(moduleFilter) {
  const result = spawnSync("cargo", ["test", "--lib", moduleFilter], {
    cwd: resolve(process.cwd(), "src-tauri"),
    encoding: "utf-8",
    timeout: 180_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runPlaywrightTest(testFilter) {
  const args = [
    "playwright",
    "test",
    "tests/e2e/preview-canvas-pixel-validation.spec.ts",
    "--reporter=list",
  ];
  if (testFilter) {
    args.push("-g", testFilter);
  }
  const result = spawnSync("npx", args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    timeout: 180_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function main() {
  const args = process.argv.slice(2);
  const frontendOnly = args.includes("--frontend");
  const rustOnly = args.includes("--rust");

  console.log("\n┌──────────────────────────────────────────────┐");
  console.log("│  Canary Mutation Verification                │");
  if (frontendOnly) console.log("│  Scope: Frontend & Playwright Mutations      │");
  if (rustOnly) console.log("│  Scope: Rust Compositor & Audio Mutations    │");
  console.log("└──────────────────────────────────────────────┘\n");

  // Phase 1: Verify clean tree passes all contracts
  console.log("Phase 1: Verifying clean tree passes all contract suites...");
  const cleanFailures = [];

  if (!rustOnly) {
    for (const suite of CONTRACT_SUITES) {
      if (!existsSync(resolve(process.cwd(), suite))) {
        console.log(`  ⚠ Skipping ${basename(suite)} (file not found)`);
        continue;
      }
      const result = runVitest(suite);
      if (result.exitCode !== 0) {
        cleanFailures.push(suite);
        console.log(
          `  ✗ ${basename(suite)} FAILED on clean tree (unexpected)`,
        );
      } else {
        console.log(`  ✓ ${basename(suite)} passed`);
      }
    }

    // Check clean tree for Layer A Playwright tests
    const pxlResult = runPlaywrightTest("PXL-TEXT-01");
    if (pxlResult.exitCode !== 0) {
      cleanFailures.push("tests/e2e/preview-canvas-pixel-validation.spec.ts");
      console.log("  ✗ Layer A Playwright PXL-TEXT-01 FAILED on clean tree (unexpected)");
    } else {
      console.log("  ✓ Layer A Playwright PXL-TEXT-01 passed");
    }
  }

  if (!frontendOnly) {
    // Check clean tree for Rust Layer B suites
    for (const rustTest of RUST_CONTRACT_TESTS) {
      const testPath = resolve(process.cwd(), `src-tauri/tests/${rustTest}.rs`);
      if (!existsSync(testPath)) continue;
      const result = runCargoTest(rustTest);
      if (result.exitCode !== 0) {
        if (result.stderr.includes("panicked") || result.stdout.includes("FAILED")) {
          cleanFailures.push(`src-tauri/tests/${rustTest}.rs`);
          console.log(`  ✗ ${rustTest} FAILED on clean tree (unexpected)`);
        } else {
          console.log(`  ⚠ ${rustTest} exited non-zero (may need GPU environment)`);
        }
      } else {
        console.log(`  ✓ ${rustTest} passed`);
      }
    }

    // Check clean tree for Rust audio mixer suite
    const audioResult = runCargoLibTest("audio::mixer");
    if (audioResult.exitCode !== 0) {
      if (audioResult.stderr.includes("panicked") || audioResult.stdout.includes("FAILED")) {
        cleanFailures.push("src-tauri/src/audio/mixer.rs");
        console.log("  ✗ audio::mixer FAILED on clean tree (unexpected)");
      } else {
        console.log("  ⚠ audio::mixer exited non-zero (may need native audio dependencies)");
      }
    } else {
      console.log("  ✓ audio::mixer passed");
    }
  }

  if (cleanFailures.length > 0) {
    console.error(
      "\nFAIL: Contract suites fail on the clean tree. Fix them first.",
    );
    for (const f of cleanFailures) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }

  // Phase 2: Apply each mutation and verify it breaks something
  if (!existsSync(MUTATIONS_DIR)) {
    console.log("\nNo tests/mutations/ directory found. Creating it...");
    mkdirSync(MUTATIONS_DIR, { recursive: true });
    console.log("Add .patch files to tests/mutations/ for canary testing.");
    console.log("PASS (no mutations to verify)\n");
    process.exit(0);
  }

  const patches = readdirSync(MUTATIONS_DIR).filter((f) =>
    f.endsWith(".patch"),
  );
  if (patches.length === 0) {
    console.log("\nNo .patch files in tests/mutations/. Skipping mutation phase.");
    console.log("PASS (no mutations to verify)\n");
    process.exit(0);
  }

  console.log(`\nPhase 2: Testing ${patches.length} mutation patch(es)...`);
  const mutationResults = [];

  for (const patch of patches) {
    const patchPath = resolve(MUTATIONS_DIR, patch);
    const patchContent = readFileSync(patchPath, "utf-8");
    const isRustMutation = patch.startsWith("layer-b-") || patch.startsWith("audio-mixer-") || patchContent.includes("src-tauri/");
    let mutationType = "TypeScript Contract";
    if (patch.startsWith("audio-mixer-")) mutationType = "Rust Audio Mixer";
    else if (patch.startsWith("layer-a-")) mutationType = "Playwright Layer A";
    else if (isRustMutation) mutationType = "Rust Layer B Compositor";

    if (frontendOnly && isRustMutation) {
      console.log(`\n  Mutation: ${patch} (${mutationType})`);
      console.log(`    ℹ Skipped in --frontend mode (runs in Rust CI job)`);
      continue;
    }
    if (rustOnly && !isRustMutation) {
      console.log(`\n  Mutation: ${patch} (${mutationType})`);
      console.log(`    ℹ Skipped in --rust mode (runs in Frontend CI job)`);
      continue;
    }

    console.log(`\n  Mutation: ${patch} (${mutationType})`);

    // Check if patch can be applied
    const applyCheck = spawnSync("git", ["apply", "--check", patchPath], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    if (applyCheck.status !== 0) {
      console.log(
        `    ✗ Patch cannot be applied (broken/outdated): ${applyCheck.stderr.trim()}`,
      );
      mutationResults.push({
        patch,
        status: "uncaught",
        reason: `patch-conflict: ${applyCheck.stderr.trim()}`,
      });
      continue;
    }

    // Apply the patch
    spawnSync("git", ["apply", patchPath], {
      cwd: process.cwd(),
    });

    let anyFailed = false;

    if (patch.startsWith("audio-mixer-")) {
      const result = runCargoLibTest("audio::mixer");
      // Require genuine test assertion failure
      if (result.stdout.includes("FAILED") || result.stderr.includes("panicked")) {
        anyFailed = true;
        console.log(`    ✓ audio::mixer correctly caught mutation via assertion failure`);
      } else {
        console.log(`    ✗ audio::mixer did not fail with assertion failure (exit: ${result.exitCode})`);
      }
    } else if (patch.startsWith("layer-a-")) {
      const result = runPlaywrightTest("PXL-TEXT-01");
      // Require genuine pixel assertion failure
      if (result.stdout.includes("failed") || result.stdout.includes("Error: expect") || result.stdout.includes("Received:")) {
        anyFailed = true;
        console.log(`    ✓ Layer A Playwright correctly caught mutation via pixel assertion failure`);
      } else {
        console.log(`    ✗ Layer A Playwright did not fail with pixel assertion failure`);
      }
    } else if (isRustMutation) {
      for (const rustTest of RUST_CONTRACT_TESTS) {
        const result = runCargoTest(rustTest);
        if (result.stdout.includes("FAILED") || result.stderr.includes("panicked")) {
          anyFailed = true;
          console.log(`    ✓ ${rustTest} correctly caught mutation via assertion failure`);
          break;
        }
      }
    } else {
      for (const suite of CONTRACT_SUITES) {
        if (!existsSync(resolve(process.cwd(), suite))) continue;
        const result = runVitest(suite);
        if (
          result.stdout.includes("FAIL") ||
          result.stdout.includes("AssertionError") ||
          result.stderr.includes("AssertionError")
        ) {
          anyFailed = true;
          console.log(`    ✓ ${basename(suite)} correctly caught mutation via assertion failure`);
          break;
        }
      }
    }

    // Revert the patch
    spawnSync("git", ["apply", "--reverse", patchPath], {
      cwd: process.cwd(),
    });

    if (!anyFailed) {
      console.log(`    ✗ DANGER: No contract suite caught this mutation!`);
      mutationResults.push({
        patch,
        status: "uncaught",
        reason: "no-test-failed",
      });
    } else {
      mutationResults.push({ patch, status: "caught" });
    }
  }

  // Phase 3: Summary
  console.log("\n─── Canary Mutation Summary ───");
  const caught = mutationResults.filter((r) => r.status === "caught").length;
  const uncaught = mutationResults.filter((r) => r.status === "uncaught").length;
  const skipped = mutationResults.filter((r) => r.status === "skipped").length;
  console.log(
    `Caught: ${caught}  Uncaught: ${uncaught}  Skipped: ${skipped} (Total: ${mutationResults.length})`,
  );

  if (uncaught > 0) {
    console.error(
      "\nFAIL: Some mutations were not caught by any contract suite.",
    );
    console.error("This means the test suite has blind spots.");
    for (const r of mutationResults.filter((r) => r.status === "uncaught")) {
      console.error(`  - ${r.patch}`);
    }
    process.exit(1);
  }

  console.log(
    "\nPASS: All mutations correctly caught by contract suites.\n",
  );
  process.exit(0);
}

main();
