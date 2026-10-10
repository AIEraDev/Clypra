---
name: behavior-coverage
description: >-
  Guides systematic user behavior discovery, multi-layer scenario mapping,
  post-implementation auditing, and Playwright UI / native test automation in Clypra.
  Activate when designing new features, fixing complex defects, evaluating test coverage,
  building UI test suites, or auditing behavioral edge cases.
---

# Behavior Coverage, Test Harness, and UI Automation Workflow

## Mission & Scope

Every implementation in Clypra must be systematically evaluated against realistic user behavior, meaningful edge cases, system failure modes, and regression risks.

This skill prevents the common AI failure mode where an agent implements only the happy path, runs a build, and declares completion without investigating boundary conditions, rapid user interactions, or failure recoveries.

Apply this workflow to every feature, bug fix, architectural refactoring, UI update, platform-specific adapter, and dependency upgrade.

---

## The 6-Step Behavior Testing Loop

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Understand the Change                                               │
│    Inspect implementation, requirements, dependencies, failure modes.  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ 2. Generate the Pre-Implementation Behavior Matrix                     │
│    Enumerate realistic user journeys, boundary cases, concurrency.     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ 3. Map Scenarios to the 5-Layer Test Architecture                      │
│    Unit, Integration, Playwright UI, Native Desktop, or Platform smoke.│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ 4. Implement & Execute Scenarios                                       │
│    Author automated tests, run them, examine failures, fix root causes.│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ 5. Perform the Post-Implementation Behavior Audit                      │
│    Re-examine actual code: discover untested branches, edge states.    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ 6. Report Evidence & Traceability Matrix                               │
│    Report automated, passed, failed, and explicitly unverified gaps.   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Mandatory Pre-Implementation Scenario Discovery

Before modifying code, inspect the affected subsystem and establish:
- **Intended user-visible behavior** from the editor's perspective.
- **Entry points and user journeys** (e.g. drag-and-drop media, menu command, keyboard shortcut, timeline scrub).
- **Existing invariants & dependencies** (e.g. `EvaluatedScene`, `PlaybackClock`, single time source).
- **Most important successful and unsuccessful workflows**.
- **Boundary conditions and unusual inputs** (e.g. 0-duration clips, empty tracks, massive 8K files).
- **Asynchronous, concurrent, timing, and cancellation behavior** (e.g. scrubbing during decode, rapid play/pause).
- **Data integrity & persistence recovery** (e.g. atomic save, project load fidelity).
- **Cross-platform differences** (e.g. Windows drive letters vs APFS, WebKitGTK vs WKWebView).
- **Existing automated tests and uncovered risk areas**.

*Rule*: Construct an initial behavior matrix before writing code. Never ask the user to enumerate scenarios that can be discovered through codebase inspection.

---

## 2. Mandatory Post-Implementation Behavior Audit

After implementing the change, perform an independent second pass. Re-examine the resulting code and ask these 12 questions:

1. **Alternative Workflows**: What can a user do differently from the ideal workflow?
2. **Repetition**: What if the user repeats the operation rapidly (e.g. clicking Play 5 times in 1 second)?
3. **Cancellation**: What if the user cancels halfway through (e.g. seeking during export or decode)?
4. **Unavailability**: What if an input, dependency, or hardware resource is unready, delayed, or missing?
5. **Exact Boundaries**: What happens at exact frame boundaries (frame 0, sequence end, clip split edge)?
6. **Concurrency**: What if operations happen rapidly or concurrently across threads or Web Workers?
7. **Out-of-Order Async**: What if asynchronous results arrive late or out of order (stale frame delivery)?
8. **Interruption**: What if the application is interrupted, restarted, or closed during the operation?
9. **Cross-Platform**: What happens when the same behavior is executed on Windows, macOS, or Linux?
10. **Neighboring Regressions**: What regressions could occur in dependent or neighboring features?
11. **Untested Branches**: Which code paths, fallback branches, or error handlers remain unexercised?
12. **State Combinations**: Are there important store state combinations that the test suite does not cover?

For every uncovered, relevant scenario, add or improve an automated test.

---

## 3. The 10 Required Scenario Categories

Every non-trivial change must evaluate applicable scenarios across these 10 categories:

| Category | Description | Representative Scenarios |
|---|---|---|
| **A. Primary Behavior** | Intended happy path from the user's perspective. | Complete workflow execution, correct visual update, expected file output. |
| **B. Alternative User Behavior** | Alternative valid interaction sequences. | Reversing operations, switching active track, changing selection, unfocusing window. |
| **C. Boundary Conditions** | Meaningful minimums, maximums, zeros, and limits. | Frame 0, empty timeline, 1-frame clip, project end, maximum zoom level. |
| **D. Invalid Input & Dependency Failures** | Malformed data, missing files, permission errors. | Corrupt video container, missing audio codec, unreadable project file, permission denied. |
| **E. Asynchronous & Concurrent Behavior** | Races, timeouts, cancellations, delayed callbacks. | Rapid scrubbing dropping stale frames, seek during decode, audio stream initialization delay. |
| **F. Persistence & Recovery** | Saving, loading, undo/redo, crash recovery. | Save $\rightarrow$ reopen fidelity, undo/redo roundtrips, atomic `.tmp` swap recovery after crash. |
| **G. UI Interaction Behavior** | Keyboard navigation, shortcuts, focus, dialogs. | Shortcut triggers (`⌘K`/`Ctrl+K`), modal trapping, timeline drag-and-drop, high-DPI scaling. |
| **H. Cross-Platform Behavior** | OS-specific paths, webviews, and conventions. | Windows drive paths (`C:/`), macOS traffic light padding (`pl-[76px]`), Linux WebKitGTK display. |
| **I. Performance & Resource Behavior** | Latency, memory growth, leaks, throughput. | Main-thread latency $<2\text{ms}$, scopes worker $<12\text{ms}$, memory stable across 100 seeks. |
| **J. Regression Behavior** | Adjacent workflows and historical defects. | Ensure Bug 1–12 fixes in `ProgramPreview.renderLoop.test.ts` continue passing. |

---

## 4. Scenario Prioritization

Prioritize scenarios to ensure maximum risk coverage:
- **P0 — Critical**: Project corruption, data loss, security violations, crashes, or essential workflow failure.
  *Policy*: **Must be automated before task completion**.
- **P1 — High**: Common editing, playback, persistence, rendering failures; incorrect user-visible results; significant resource leaks; serious regressions.
  *Policy*: **Must be automated before task completion**.
- **P2 — Medium**: Uncommon edge cases, recoverable errors, platform-specific limitations.
  *Policy*: Automated based on risk, frequency, and maintenance cost.
- **P3 — Low**: Minor cosmetic inconsistencies or low-impact display differences.

---

## 5. The Five-Layer Test Architecture

Select the lowest-cost test layer capable of proving the required behavior:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 5 — Release & Platform Verification                              │
│ Packaged .dmg/.msi/.deb bundles, sidecar magic headers, smoke tests.   │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 4 — Native Desktop UI Tests (WebdriverIO + @wdio/tauri-service)   │
│ Real desktop binary execution, native menus, OS window lifecycle.      │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 3 — Playwright Frontend Tests (playwright test)                  │
│ Real browser UI workflows with controlled Tauri native IPC mocks.      │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 2 — Integration Tests (Vitest + Cargo test)                      │
│ Store interactions, Web Worker clients, media probing, EvaluatedScene. │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 1 — Unit & Domain Tests (Vitest)                                 │
│ Pure timeline math, SMPTE timecode, gap engine, frame boundary clamp.  │
└────────────────────────────────────────────────────────────────────────┘
```

### Layer Guidelines:
- **Layer 1 (Unit)**: Pure deterministic math, timecode conversions, state transforms.
- **Layer 2 (Integration)**: Store interactions, audio controller state machines, worker protocols, Rust compositing shaders.
- **Layer 3 (Playwright Frontend)**: Real browser user interaction with full DOM, CSS, drag-and-drop, and UI state, using a **controlled mock boundary** for Tauri IPC and filesystem operations.
- **Layer 4 (Native Desktop)**: WebdriverIO with `@wdio/tauri-service` for true native desktop application testing on real operating systems.
- **Layer 5 (Release Verification)**: `npm run smoke:bundle`, sidecar binary checks, and platform installer verification.

---

## 6. Playwright Frontend UI Testing Architecture

### 6.1 Purpose & Role
Playwright executes real browser-based UI automation against Clypra's Vite frontend, testing interactive workflows, DOM events, shortcuts, and modal dialogs.

### 6.2 The Controlled Native Mock Boundary
In browser mode, native Tauri APIs (`invoke`, `plugin-dialog`, `plugin-fs`) are mocked via [`tests/e2e/mocks/tauriMock.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/tests/e2e/mocks/tauriMock.ts):
- Mocks simulate command responses (e.g. `get_recent_projects`, `load_project`, `save_project`, `get_media_metadata`).
- **Strict Invariant**: Browser mocks **never** represent proof that native Rust decoders, filesystem locking, or OS graphics drivers function. Native behavior is verified in Layers 2, 4, and 5.
- Mocks must strictly adhere to production TypeScript interfaces in `src/types/`.

### 6.3 Best Practices
- Use accessible, role-based locators (`getByRole`, `getByLabel`, `getByTestId`).
- Use retrying assertions (`await expect(locator).toBeVisible()`). Never use arbitrary `page.waitForTimeout()`.
- Enable trace and screenshot collection on failure (`trace: 'retain-on-failure'`).

---

## 7. Behavior-to-Test Traceability Matrix

For every non-trivial change, report scenarios using this standard schema:

| Scenario ID | User Behavior / Triggering Condition | Preconditions & Inputs | Expected Invariant / Outcome | Priority | Test Layer | Test Identifier | Result |
|---|---|---|---|---|---|---|---|
| `SCN-01` | User clicks New Project on launch screen | Application loaded at `/` | Navigates to editor; blank timeline rendered | P0 | Layer 3 (Playwright) | `editor-workflow.spec.ts` | **PASS** |
| `SCN-02` | User splits clip at exact playhead frame | Clip selected, playhead at 2.5s | 2 clips created; total duration preserved | P0 | Layer 1 (Unit) | `Clip.test.tsx` | **PASS** |
| `SCN-03` | User seeks while video decode in flight | Scrubbing timeline rapidly | Older in-flight frames discarded; no flicker | P1 | Layer 2 (Integration) | `ProgramPreview.renderLoop.test.ts` | **PASS** |
| `SCN-04` | Audio device disconnected during playback | Playing video with audio | Clock falls back to wall-clock; video continues | P1 | Layer 2 (Integration) | `nativeAudioTimeline.test.ts` | **PASS** |

---

## 8. Definition of Done Checklist

An engineering task is complete only when:
- [ ] Pre-implementation scenario discovery identified in-scope journeys and edge cases.
- [ ] Post-implementation behavior audit evaluated the 12 questions against actual code.
- [ ] Applicable scenarios classified across the 10 categories (A through J).
- [ ] All in-scope **P0 and P1 scenarios automated** with executable tests.
- [ ] Tests selected at the lowest-cost appropriate layer (Layers 1–5).
- [ ] Playwright UI tests executed for affected frontend workflows.
- [ ] Traceability matrix documented with separate counts:
  - Scenarios Identified
  - Scenarios Automated
  - Scenarios Executed & Passed
  - Scenarios Failed (must be 0)
  - Explicitly Unverified Gaps (with technical justification)
- [ ] `npm run docs:check` passed with 0 broken links.
- [ ] `npx tsc --noEmit` passed with 0 errors.
