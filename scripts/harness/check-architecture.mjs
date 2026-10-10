import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const failures = [];

console.log("🔍 Running Clypra Architectural Invariants & Fitness Checks...\n");

// ── Check 1: Render Loop Invariant (NativeProgramPreview.tsx) ───────────────
// Invariant: NativeProgramPreview must consume EvaluatedScene and NEVER call timelineStore.getState() directly.
try {
  const nativePreviewPath = path.join(
    root,
    "src/components/editor/preview/NativeProgramPreview.tsx",
  );
  const content = await readFile(nativePreviewPath, "utf8");
  if (content.includes("timelineStore.getState()")) {
    failures.push(
      "Architectural Violation [Domain 2]: NativeProgramPreview.tsx directly calls `timelineStore.getState()`. Render loops must consume `EvaluatedScene` exclusively.",
    );
  } else {
    console.log("✅ [Domain 2: Preview] NativeProgramPreview respects EvaluatedScene currency invariant.");
  }
} catch (err) {
  failures.push(`Failed to inspect NativeProgramPreview.tsx: ${err.message}`);
}

// ── Check 2: Append-Only Preview Test Baseline (>= 156 tests) ───────────────
try {
  const previewTestPath = path.join(
    root,
    "src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts",
  );
  const testContent = await readFile(previewTestPath, "utf8");
  const testMatches = testContent.match(/\b(it|test)\s*\(/g) || [];
  const testCount = testMatches.length;
  const MIN_BASELINE = 156;

  if (testCount < MIN_BASELINE) {
    failures.push(
      `Architectural Violation [Domain 2]: ProgramPreview.renderLoop.test.ts has ${testCount} tests, which is below the mandatory append-only baseline of ${MIN_BASELINE}. Tests must never be deleted or skipped.`,
    );
  } else {
    console.log(
      `✅ [Domain 2: Preview] Append-only test baseline verified (${testCount} >= ${MIN_BASELINE} tests).`,
    );
  }
} catch (err) {
  failures.push(`Failed to inspect ProgramPreview.renderLoop.test.ts: ${err.message}`);
}

// ── Check 3: Store Isolation Boundary (src/store/) ─────────────────────────
// Invariant: Stores must own their domain. Cross-store mutations must be passed as arguments or coordinated by commands.
try {
  const storeDir = path.join(root, "src/store");
  const files = await readdir(storeDir);
  let storeViolations = 0;

  for (const file of files) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const content = await readFile(path.join(storeDir, file), "utf8");

    // Check if a store file imports another store and invokes its setters inside actions
    // For example, timelineStore calling projectStore.getState().setProject(...)
    if (file === "timelineStore.ts" && content.includes("projectStore.getState()")) {
      failures.push(
        `Architectural Violation [Domain 1]: ${file} directly calls projectStore.getState(). Data must be passed via arguments or command dispatch.`,
      );
      storeViolations++;
    }
  }

  if (storeViolations === 0) {
    console.log("✅ [Domain 1: Timeline] Zustand store isolation invariants verified.");
  }
} catch (err) {
  failures.push(`Failed to inspect store boundaries: ${err.message}`);
}

// ── Check 4: Documentation Link Integrity ───────────────────────────────────
try {
  execFileSync("node", ["scripts/check-doc-links.mjs"], { stdio: "pipe", cwd: root });
  console.log("✅ [Docs & Contracts] Local Markdown link integrity verified.");
} catch (err) {
  failures.push(`Documentation Link Check Failed: ${err.message}`);
}

// ── Check 5: Internationalization Catalog Parity ───────────────────────────
try {
  execFileSync("node", ["scripts/check-i18n.mjs"], { stdio: "pipe", cwd: root });
  console.log("✅ [Domain 7: i18n] 9-locale catalog key and placeholder parity verified.");
} catch (err) {
  failures.push(`i18n Catalog Parity Check Failed: ${err.message}`);
}

// ── Check 6: Multi-Agent Skills Synchronization ────────────────────────────
try {
  execFileSync("node", ["scripts/sync-kiro-skills.mjs", "--check"], {
    stdio: "pipe",
    cwd: root,
  });
  console.log("✅ [Multi-Agent Harness] Kiro skills synchronized with canonical .agents/skills/.");
} catch (err) {
  failures.push(`Multi-Agent Skills Sync Failed: ${err.message}`);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("--------------------------------------------------");
if (failures.length > 0) {
  console.error("❌ Architectural Fitness Violations Detected:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
} else {
  console.log("🎉 ALL Clypra Architectural Invariants & Fitness Checks PASSED.\n");
  process.exit(0);
}
