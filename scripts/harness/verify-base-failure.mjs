#!/usr/bin/env node
/**
 * verify-base-failure.mjs — Validates that test failures on the base commit
 * are legitimate ASSERTION failures, not import/syntax/environment errors.
 *
 * Traps prevented:
 * - Tests importing helper code that doesn't exist on base commit (passes for wrong reason)
 * - Tests failing with syntax errors
 * - Tests skipped or 0 tests collected
 *
 * Usage: node scripts/harness/verify-base-failure.mjs /path/to/vitest-results.json
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const resultsPath = process.argv[2] || "/tmp/vitest-results.json";

if (!existsSync(resultsPath)) {
  console.error(`::error::Vitest results file not found at: ${resultsPath}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(resolve(process.cwd(), resultsPath), "utf-8"));
} catch (err) {
  console.error(`::error::Failed to parse Vitest JSON reporter output: ${err}`);
  process.exit(1);
}

const totalTests = data.numTotalTests || 0;
const failedTests = data.numFailedTests || 0;

if (totalTests === 0) {
  console.error("::error::INVALID FAILURE: No tests were collected or executed on the base commit.");
  console.error("This usually indicates an import error, module resolution failure, or syntax error before test collection.");
  process.exit(1);
}

if (failedTests === 0) {
  console.error("::error::INVALID: All tests passed on the base commit! The bug was not reproduced.");
  process.exit(1);
}

let assertionFailureCount = 0;
const invalidFailures = [];

for (const testFile of data.testResults || []) {
  for (const assertion of testFile.assertionResults || []) {
    if (assertion.status === "failed") {
      const messages = (assertion.failureMessages || []).join("\n");
      const isAssertion =
        messages.includes("AssertionError") ||
        messages.includes("expected") ||
        messages.includes("toBe") ||
        messages.includes("toEqual") ||
        messages.includes("toThrow");

      if (isAssertion) {
        assertionFailureCount++;
        const firstLine = (assertion.failureMessages?.[0] || "").split("\n")[0];
        console.log(`  ✓ Legitimate assertion failure: "${assertion.title}" (${firstLine})`);
      } else {
        invalidFailures.push({
          title: assertion.title,
          message: assertion.failureMessages?.[0] || "Unknown error",
        });
      }
    }
  }
}

if (assertionFailureCount === 0) {
  console.error("::error::INVALID FAILURE: Tests failed on base, but NONE of the failures were assertion failures!");
  console.error("Errors found:");
  invalidFailures.forEach((f) => console.error(`  ✗ ${f.title}: ${f.message}`));
  process.exit(1);
}

console.log(`\n✓ Base commit verification PASSED: ${assertionFailureCount} legitimate assertion failure(s) confirmed.`);
process.exit(0);
