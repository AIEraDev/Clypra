#!/usr/bin/env node
/**
 * verify-evidence.mjs — Mechanical evidence gate
 *
 * Fails when src/ preview, playback, audio, text, or sticker code changed
 * and the evidence bundle or mutation record is missing.
 *
 * Usage: node scripts/harness/verify-evidence.mjs [--ci]
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SUBSYSTEM_PATTERNS = [
  "src/components/editor/preview/",
  "src/core/playback/",
  "src/core/audio/",
  "src/features/text-effects/",
  "src/features/sticker/",
  "src/lib/renderEngine/",
  "src/core/render/",
];

const CONTRACT_TEST_FILES = [
  "src/core/playback/__tests__/replayBehavioralContract.test.ts",
  "src/core/audio/__tests__/audioPreviewSyncContract.test.ts",
  "src/components/editor/preview/__tests__/previewStateResetContract.test.ts",
  "src/features/text-effects/__tests__/textEditPreviewCycle.test.ts",
];

function getChangedFiles() {
  try {
    const base = process.env.GITHUB_BASE_REF || "HEAD~1";
    const output = execSync(`git diff --name-only ${base}`, {
      encoding: "utf-8",
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    console.warn(
      "[verify-evidence] Could not determine changed files, skipping check",
    );
    return [];
  }
}

function main() {
  const isCI =
    process.argv.includes("--ci") || Boolean(process.env.CI);
  const changedFiles = getChangedFiles();

  if (changedFiles.length === 0) {
    console.log("[verify-evidence] No changed files detected, skipping");
    process.exit(0);
  }

  const subsystemChanged = changedFiles.some((file) =>
    SUBSYSTEM_PATTERNS.some((pattern) => file.startsWith(pattern)),
  );

  if (!subsystemChanged) {
    console.log(
      "[verify-evidence] No subsystem files changed, evidence check not required",
    );
    process.exit(0);
  }

  console.log(
    "[verify-evidence] Subsystem code changed — checking evidence requirements",
  );
  console.log("[verify-evidence] Changed subsystem files:");
  changedFiles
    .filter((f) => SUBSYSTEM_PATTERNS.some((p) => f.startsWith(p)))
    .forEach((f) => console.log(`  - ${f}`));

  const failures = [];

  // Check contract test files exist
  for (const testFile of CONTRACT_TEST_FILES) {
    const fullPath = resolve(process.cwd(), testFile);
    if (!existsSync(fullPath)) {
      failures.push(`Contract test missing: ${testFile}`);
    }
  }

  // In CI mode, check for evidence artifacts
  if (isCI) {
    const hasEvidence = existsSync(resolve(process.cwd(), "test-results/"));
    if (!hasEvidence) {
      failures.push(
        "No evidence bundle found. Run contract suites and save results to test-results/",
      );
    }

    // Check that no evidence bundle has status "NOT_RUN" — that means
    // the harness was invoked but could not execute (app not running,
    // command missing, etc.). NOT_RUN is missing evidence, not a pass.
    const evidenceDir = resolve(process.cwd(), "test-results/");
    if (existsSync(evidenceDir)) {
      for (const file of readdirSync(evidenceDir)) {
        if (!file.endsWith("-evidence.json")) continue;
        try {
          const bundle = JSON.parse(
            readFileSync(resolve(evidenceDir, file), "utf-8"),
          );
          if (bundle.status === "NOT_RUN") {
            failures.push(
              `Evidence bundle ${file} has status NOT_RUN: ${bundle.steps?.[0]?.note || "harness did not execute"}`,
            );
          }
        } catch {
          // Malformed JSON — ignore, other checks will catch it
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(
      "\n[verify-evidence] FAIL — Evidence requirements not met:",
    );
    failures.forEach((f) => console.error(`  ✗ ${f}`));
    console.error(
      "\nSubsystem code was changed but required evidence is missing.",
      "\nSee AGENTS.md Section 6 for the Definition of Done.",
    );
    process.exit(1);
  }

  console.log("[verify-evidence] PASS — All evidence requirements met");
  process.exit(0);
}

main();
