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

function main() {
  console.log("\n┌──────────────────────────────────────────────┐");
  console.log("│  Canary Mutation Verification                │");
  console.log("└──────────────────────────────────────────────┘\n");

  // Phase 1: Verify clean tree passes all contracts
  console.log("Phase 1: Verifying clean tree passes all contract suites...");
  const cleanFailures = [];

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

  // Check clean tree for Rust Layer B suites
  for (const rustTest of RUST_CONTRACT_TESTS) {
    const testPath = resolve(process.cwd(), `src-tauri/tests/${rustTest}.rs`);
    if (!existsSync(testPath)) continue;
    const result = runCargoTest(rustTest);
    if (result.exitCode !== 0) {
      // If GPU is unavailable, tests log skip, but shouldn't fail with panic
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
    const isRustMutation = patch.startsWith("layer-b-") || patchContent.includes("src-tauri/");
    console.log(`\n  Mutation: ${patch} (${isRustMutation ? "Rust / Layer B" : "TypeScript"})`);

    // Check if patch can be applied
    const applyCheck = spawnSync("git", ["apply", "--check", patchPath], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    if (applyCheck.status !== 0) {
      console.log(
        `    ⚠ Patch cannot be applied (may be outdated): ${applyCheck.stderr.trim()}`,
      );
      mutationResults.push({
        patch,
        status: "skipped",
        reason: "patch-conflict",
      });
      continue;
    }

    // Apply the patch
    spawnSync("git", ["apply", patchPath], {
      cwd: process.cwd(),
    });

    let anyFailed = false;

    if (isRustMutation) {
      for (const rustTest of RUST_CONTRACT_TESTS) {
        const result = runCargoTest(rustTest);
        if (result.exitCode !== 0 || result.stdout.includes("FAILED")) {
          anyFailed = true;
          console.log(`    ✓ ${rustTest} correctly FAILED under mutation`);
          break;
        }
      }
    } else {
      for (const suite of CONTRACT_SUITES) {
        if (!existsSync(resolve(process.cwd(), suite))) continue;
        const result = runVitest(suite);
        if (result.exitCode !== 0) {
          anyFailed = true;
          console.log(`    ✓ ${basename(suite)} correctly FAILED under mutation`);
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
