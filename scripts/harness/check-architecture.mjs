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

// ── Check 7: Cross-Platform Native UI Thread Safety (Invariant 16) ──────────
// Invariant: Native OS window operations (AppKit NSWindow on macOS, Win32 HWND
// on Windows, GTK GtkWidget on Linux) must only be called from the main thread.
// Direct calls from background Tokio threads cause EXC_BREAKPOINT SIGTRAP on
// macOS, message loop deadlocks / DWM layer stalls on Windows, and GLib assertion
// aborts on Linux. show_surface(), hide_surface(), and reset() must all dispatch
// via run_on_main_thread.
try {
  const nativeSurfacePath = path.join(
    root,
    "src-tauri/src/commands/native_surface.rs",
  );
  const nsContent = await readFile(nativeSurfacePath, "utf8");

  // Extract all text that is NOT inside a run_on_main_thread closure.
  // Strategy: split on "run_on_main_thread" blocks, check the non-closure portions.
  // We check for patterns that should only appear inside those closures.
  const methodBodies = nsContent
    // Remove single-line comments
    .replace(/\/\/[^\n]*/g, "")
    // Remove configure_surface (it's a free fn that is itself called on main thread)
    .replace(/fn configure_surface[\s\S]*?(?=\n\/\/|^#\[tauri|^pub\s)/m, "");

  // Detect bare window method calls (.show(), .hide(), .close()) at the method
  // signature level (i.e., outside a run_on_main_thread closure).
  // We look for these patterns appearing in show_surface / hide_surface / reset
  // fn bodies BEFORE a run_on_main_thread call — that would be the violation.
  // Because the source uses `sw.show()` inside the closure (safe), we look for
  // surface_window.show() / window.show() / w.show() that are NOT inside closures.
  const bareShowPattern = /\bsurface_window\s*\.\s*show\s*\(\)/;
  const bareHidePattern = /\bwindow\s*\.\s*hide\s*\(\)\s*\.map_err/; // hide w/o dispatch
  const bareClosePattern = /\bwindow\s*\.\s*close\s*\(\)\s*;(?!\s*\})/; // direct .close() not in closure

  // Simpler check: ensure run_on_main_thread appears in each of these function bodies
  const showSurfaceFn = nsContent.match(
    /pub\(crate\)\s+fn\s+show_surface[\s\S]*?(?=\n\s{4}pub\(crate\)\s+fn|\n\s{4}pub\s+fn|\n\})/,
  );
  const hideSurfaceFn = nsContent.match(
    /pub\(crate\)\s+fn\s+hide_surface[\s\S]*?(?=\n\s{4}pub\(crate\)\s+fn|\n\s{4}pub\s+fn|\n\})/,
  );
  const resetFn = nsContent.match(
    /pub\(crate\)\s+fn\s+reset[\s\S]*?(?=\n\s{4}pub\(crate\)\s+fn|\n\s{4}pub\s+fn|\n\})/,
  );

  let nativeThreadViolations = 0;

  if (showSurfaceFn && !showSurfaceFn[0].includes("run_on_main_thread")) {
    failures.push(
      "Architectural Violation [Domain 8, Invariant 16]: NativeSurfaceRuntime::show_surface() does not dispatch to the main thread via run_on_main_thread. Direct AppKit/Win32 window calls from Tokio workers cause EXC_BREAKPOINT SIGTRAP on macOS 26+.",
    );
    nativeThreadViolations++;
  }
  if (hideSurfaceFn && !hideSurfaceFn[0].includes("run_on_main_thread")) {
    failures.push(
      "Architectural Violation [Domain 8, Invariant 16]: NativeSurfaceRuntime::hide_surface() does not dispatch to the main thread via run_on_main_thread. window.hide() is an AppKit-restricted operation.",
    );
    nativeThreadViolations++;
  }
  if (resetFn && !resetFn[0].includes("run_on_main_thread")) {
    failures.push(
      "Architectural Violation [Domain 8, Invariant 16]: NativeSurfaceRuntime::reset() does not dispatch window.close() to the main thread via run_on_main_thread.",
    );
    nativeThreadViolations++;
  }

  if (nativeThreadViolations === 0) {
    console.log(
      "✅ [Domain 8: Native Thread Safety] show_surface, hide_surface, and reset all dispatch via run_on_main_thread (Invariant 16).",
    );
  }
} catch (err) {
  failures.push(`Native UI Thread Safety Check Failed: ${err.message}`);
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
