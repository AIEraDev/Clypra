# Clypra Automated Testing Strategy & Verification Harness

## 1. Testing Philosophy & Invariants

In a native desktop non-linear video editor (NLE), defects manifest as playhead jitter, audio/video desynchronization, corrupted timeline state, race conditions during scrubbing, or application crashes during export.

Clypra enforces an evidence-based testing philosophy:
- **Behavior-Driven Coverage**: Every change must be evaluated against realistic user behavior, meaningful edge cases, system failure modes, and regression risks.
- **Determinism**: Tests must yield identical outcomes regardless of execution order, host CPU speed, or OS environment.
- **Appropriate Layering**: Domain mathematics must be tested with fast unit tests; UI workflows with Playwright; and packaged binaries with native smoke tests. Never use an expensive test when a lower-cost test proves the invariant more precisely.
- **Evidence-Driven Regression Prevention**: Every fixed bug must have an automated regression test that proves the fix and permanently guards against regression.

---

## 2. The Five-Layer Test Architecture

Clypra organizes testing into five distinct, non-overlapping verification layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 5 — Release & Platform Verification                              │
│ Packaged bundles (.dmg, .msi, .deb), sidecar magic headers, smoke tests│
├────────────────────────────────────────────────────────────────────────┤
│ Layer 4 — Native Desktop UI Tests (WebdriverIO + @wdio/tauri-service)   │
│ Real desktop binary execution, native menus, OS window lifecycle       │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 3 — Playwright Frontend UI Tests (npx playwright test)           │
│ Real browser UI workflows with controlled Tauri native IPC mocks       │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 2 — Subsystem Integration Tests (Vitest + Cargo test)            │
│ Store workflows, worker client protocols, audio controller, EvaluatedScene│
├────────────────────────────────────────────────────────────────────────┤
│ Layer 1 — Unit & Domain Tests (Vitest)                                 │
│ Pure timeline math, SMPTE timecodes, gap engine, frame boundary clamp  │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Layer 1: Unit & Domain Tests (Vitest)
- **Scope**: Pure, deterministic TypeScript logic with zero DOM or network dependencies.
- **Coverage Areas**:
  - `src/lib/timecode/`: SMPTE frame math, drop-frame (DF) / non-drop-frame (NDF) calculations, rational time arithmetic.
  - `src/lib/timeline/`: Placement engine, magnetic snapping, gap engine ripple collapse.
  - `src/core/animation/`: Bézier curve interpolation, keyframe math.
  - `src/core/evaluation/`: Scene graph evaluation (`EvaluatedScene`), transform matrices, crop boxes.
- **Speed**: Sub-second execution for rapid inner-loop feedback.

### 2.2 Layer 2: Subsystem Integration Tests (Vitest & Cargo test)
- **Scope**: Component interactions, Zustand store transitions, Web Worker message protocols, and Rust engine components.
- **Coverage Areas**:
  - `ProgramPreview.renderLoop.test.ts`: Append-only regression suite (155 tests) governing frame scheduling, playback clock authority, and readback policies.
  - `src/store/__tests__/`: Project serialization, dirty tracking, undo/redo command execution.
  - `src/core/audio/__tests__/`: Audio clip alignment, mute/solo flags, fade curve generation, CPAL controller state machine.
  - `src-tauri/src/thumbnail_engine/`: mmap cache pruning, corrupt tile quarantine.
  - `src-tauri/src/sync_metrics.rs`: Frame pacing accumulation and AV drift tracking.
  - `src-tauri/tests/`: Multi-track compositor shaders, golden pixel tests, and real-time audio callback safety.

### 2.3 Layer 3: Playwright Frontend UI Tests (`npx playwright test`)
- **Scope**: Real browser user-interface workflows executed in an automated browser context (Chromium/WebKit).
- **Coverage Areas**:
  - Launch screen, project creation, and project opening.
  - Editor layout, timeline viewports, panels, and toolbar actions.
  - Dialogs, modal trapping, selection, and keyboard shortcuts (`⌘K` / `Ctrl+K`).
  - Loading states, error banners, and recovery states.
- **Controlled Native Mock Boundary**: Native Tauri APIs (`invoke`, `plugin-dialog`, `plugin-fs`) are mocked via [`tests/e2e/mocks/tauriMock.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/tests/e2e/mocks/tauriMock.ts).
- **Invariant**: Browser-based Playwright mocks simulate frontend contracts; they **never** represent proof that native Rust decoders, filesystem locking, or OS graphics drivers function.

### 2.4 Layer 4: Native Desktop UI Tests (WebdriverIO + `@wdio/tauri-service`)
- **Scope**: End-to-end testing of the compiled desktop application binary (`.app`, `.exe`, Linux executable).
- **Coverage Areas**:
  - Actual application window creation, native menus, and window resizing.
  - Native file dialog invocation (`@tauri-apps/plugin-dialog`).
  - Native process lifecycle, shutdown, and restart.
- **Reference**: Follows official Tauri v2 testing recommendations utilizing WebdriverIO with `@wdio/tauri-service`.
- **Privilege Boundary**: Privileged testing capabilities and debug endpoints are strictly kept out of production release builds.

### 2.5 Layer 5: Release & Platform Verification
- **Scope**: Bundled sidecars, installer staging, and production assets across macOS, Windows, and Linux.
- **Execution**:
  - `npm run smoke:bundle`: Unpacks built bundles, validates frontend HTML entrypoint, assets, workers, manifest synchronization, and verifies clean binary startup and termination.
  - `node scripts/verify-sidecars.mjs`: Validates GPL FFmpeg/FFprobe binaries against target triples and magic headers.
  - `node scripts/verify-msix-staging.mjs`: Validates Windows MSIX packaging layouts.

---

## 3. Mandatory Behavior Coverage & Scenario Discovery

Every feature and defect fix must execute the **6-Step Behavior Testing Loop**:

1. **Understand the Change**: Inspect implementation, requirements, dependencies, and failure modes.
2. **Pre-Implementation Scenario Discovery**: Enumerate realistic user journeys, boundary cases, concurrency, and platform variations before writing code.
3. **Map Scenarios to Layers**: Assign each scenario to the lowest-cost appropriate layer (Layers 1–5).
4. **Implement & Execute**: Author tests, run them, examine failures, and fix the implementation.
5. **Post-Implementation Behavior Audit**: Perform an independent second pass asking the 12 audit questions (alternative workflows, repetition, cancellation, unavailability, exact boundaries, concurrency, out-of-order async, interruption, platform differences, neighboring regressions, untested branches, untested state combinations).
6. **Report Evidence**: Provide a behavior-to-test traceability matrix.

### 3.1 The 10 Required Scenario Categories
Every non-trivial change must evaluate applicable scenarios across:
- **A. Primary Behavior**: Core happy-path user workflow.
- **B. Alternative User Behavior**: Alternative valid sequences, reversing edits, switching sources.
- **C. Boundary Conditions**: Frame 0, empty timeline, 1-frame clip, project head/tail.
- **D. Invalid Input & Dependency Failures**: Missing files, unprobed codecs, permission denials.
- **E. Asynchronous & Concurrent Behavior**: Rapid scrubbing, seek during decode, audio device delay.
- **F. Persistence & Recovery**: Save $\rightarrow$ reopen fidelity, undo/redo roundtrips, atomic swap recovery.
- **G. UI Interaction Behavior**: Shortcuts, modal dialogs, focus trapping, drag-and-drop.
- **H. Cross-Platform Behavior**: Windows drive paths, macOS traffic light padding, Linux WebKitGTK.
- **I. Performance & Resource Behavior**: Latency budgets, memory leak prevention, queue back-pressure.
- **J. Regression Behavior**: Adjacent features and historical bug guards.

### 3.2 Scenario Prioritization
- **P0 (Critical)**: Project corruption, data loss, security violations, crashes $\rightarrow$ **Mandatory automation**.
- **P1 (High)**: Common editing/playback/rendering failures, incorrect results $\rightarrow$ **Mandatory automation**.
- **P2 (Medium)**: Uncommon edge cases, recoverable errors $\rightarrow$ Automated based on risk.
- **P3 (Low)**: Minor cosmetic inconsistencies $\rightarrow$ Automated as appropriate.

---

## 4. Behavior-to-Test Traceability Matrix Schema

When completing an engineering task, document scenarios using this schema:

| Scenario ID | User Behavior / Triggering Condition | Preconditions & Inputs | Expected Invariant / Outcome | Priority | Test Layer | Test Identifier | Result |
|---|---|---|---|---|---|---|---|
| `SCN-01` | User clicks New Project on launch screen | Application loaded at `/` | Navigates to editor; blank timeline rendered | P0 | Layer 3 (Playwright) | `editor-workflow.spec.ts` | **PASS** |
| `SCN-02` | User splits clip at exact playhead frame | Clip selected, playhead at 2.5s | 2 clips created; total duration preserved | P0 | Layer 1 (Unit) | `Clip.test.tsx` | **PASS** |
| `SCN-03` | User seeks while video decode in flight | Scrubbing timeline rapidly | Older in-flight frames discarded; no flicker | P1 | Layer 2 (Integration) | `ProgramPreview.renderLoop.test.ts` | **PASS** |

---

## 5. Playwright Test Architecture & Native Mock Boundary

Playwright executes real browser-based UI automation against Clypra's Vite frontend:
- **Configuration**: [`playwright.config.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/playwright.config.ts) configures automated local web servers (`http://127.0.0.1:5173`), Chromium/WebKit browser engines, retries, and failure traces (`retain-on-failure`).
- **Mock Boundary**: [`tests/e2e/mocks/tauriMock.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/tests/e2e/mocks/tauriMock.ts) injects controlled mock implementations of `window.__TAURI_INTERNALS__` and Tauri plugins into the browser context.
- **Locators**: Prefer accessible roles (`getByRole`, `getByLabel`) and stable test identifiers (`getByTestId`).
- **Assertions**: Always use auto-retrying web assertions (`await expect(locator).toBeVisible()`). Never use arbitrary `page.waitForTimeout()`.

---

## 6. Canonical Verification Commands & Quality Gates

| Verification Command | Scope / Layer | When to Execute |
|---|---|---|
| `npm run docs:check` | Local Markdown link integrity | Every doc or link update |
| `npx tsc --noEmit` | Strict TypeScript typecheck (0 errors) | Every code modification |
| `npx vitest run <file>` | Layer 1 & 2 Unit/Integration tests | Fast inner loop during development |
| `npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts` | 155-test preview render loop regression suite | Playback, clock, or preview edits |
| `npx playwright test` | Layer 3 Playwright frontend UI tests | UI, layout, modal, shortcut edits |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Layer 2 Rust backend memory & decoders | Native Rust engine modifications |
| `npm run smoke:bundle` | Layer 5 Packaged application smoke test | Pre-release and PR validation |
| `npm run check` | Aggregate Gate (`docs:check` + `typecheck` + `test`) | Pre-commit / PR gate |
