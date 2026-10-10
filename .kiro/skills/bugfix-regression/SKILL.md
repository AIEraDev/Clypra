---
name: bugfix-regression
description: >-
  Guides AI agents through diagnosing, reproducing, fixing, and permanently testing defects in Clypra.
  Activate when investigating crashes, rendering freezes, audio/video drift, playhead glitches, timeline
  corruption, or unexpected behavior. Enforces evidence-based diagnosis and mandatory regression tests.
---

# Bugfix & Regression Prevention Workflow

## Overview
Clypra enforces strict bugfix discipline: **One bug = One fix + One regression test**.
Every bug fix must be evidence-driven. Never guess at a fix or apply superficial patches that mask underlying race conditions or state desynchronization.

---

## When to Use This Skill
- Diagnosing and resolving reported bugs in playback, timeline, export, or audio.
- Investigating failed tests or CI pipeline failures.
- Addressing race conditions during asset hydration or IPC communication.
- Fixing memory leaks or unreleased GPU resources.

## When NOT to Use This Skill
- Implementing new capabilities or architectural refactors (use `feature-implementation`).
- Performing code review without changing code (use `code-review`).

---

## Step-by-Step Procedure

### 1. Reproduce the Defect
- Formulate the smallest, deterministic reproduction scenario.
- Identify the exact inputs, timeline state, asset characteristics (codec, sample rate, dimensions), and playback actions needed.
- If the bug is timing-dependent or an async race condition, isolate the ordering anomaly (e.g., probe delay vs. playhead advance).
- **Rule**: Do not claim to have reproduced a failure unless reproduction was actually observed or demonstrated via a test.

### 2. Collect Diagnostics & Telemetry
- Inspect telemetry events and session logs if available:
  - macOS: `~/Library/Application Support/com.deenminder.clypra/perf_logs/`
  - Look for `native-sync`, `audio-snapshot`, `frontend-av-sync`, `seek-span`.
- Inspect Rust console logs or error outputs.
- Capture stack traces, failed assertion messages, and unexpected state transitions.

### 3. Separate Symptoms from Root Cause
- Ask:
  - Is the symptom a freeze, silence, visual glitch, or crash?
  - What is the root cause? (e.g., `renderInFlight` flag not reset in catch block; `asset.path` accessed before hydration; double RAF dispatch).
- Distinguish the upstream triggering event from the downstream consequence. Never apply a patch to the downstream symptom if the upstream invariant was violated.

### 4. Write a Failing Regression Test First
- Create an automated test that reproduces the defect and fails under the unpatched codebase.
- **Preview Render Loop & Clock Bugs**:
  - Append a new `describe("Bug N — <Title>", () => { ... })` block to:
    `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts`
  - Note: This suite is append-only. Never delete or skip earlier bug tests.
- **Core Engine & Store Bugs**:
  - Add or append regression tests in the respective `__tests__/` directory (e.g., `src/core/media/__tests__/`, `src/store/__tests__/`).
- **Rust Backend Bugs**:
  - Add regression tests in `src-tauri/tests/audit_regressions.rs` or the relevant module test.

### 5. Correct the Root Cause
- Implement the minimal, robust fix targeting the verified root cause.
- Maintain existing invariants:
  - Guard closure state with epoch counters.
  - Reset state flags (e.g. `renderInFlight`) across all exit paths (early returns, errors, finally).
  - Handle asynchronous promises with explicit cancellation and rejection handlers.
- Preserve existing comments and docstrings.

### 6. Verify the Fix & Run Neighboring Tests
- Verify that the new regression test now passes.
- Run all related tests in the subsystem:
```bash
# Preview render loop suite
npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts

# Subsystem tests
npx vitest run <path/to/affected/__tests__/>

# Type checking
npx tsc --noEmit
```

### 7. Analyze Edge Cases & Resource Cleanup
- Check boundary conditions:
  - Zero-duration clips, empty timelines, end-of-track boundaries.
  - Silent video assets (no audio track), audio-only assets.
  - Rapid repeated user actions (scrub spam, play/pause double-click).
  - Web Worker termination or IPC timeout scenarios.

### 8. Document & Report
Report:
- Observed defect and reproduction mechanism.
- Root cause identified.
- Minimal fix applied.
- Regression test added (file, test description, execution result).
- Full verification command results.
