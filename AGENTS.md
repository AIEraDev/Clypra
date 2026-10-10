# Clypra — Portable AI Agent Standards (AGENTS.md)
# Canonical, provider-neutral repository instructions for all coding agents.
# Automatically loaded by: Antigravity, Kiro, Cursor, OpenAI Codex, Copilot.

## 1. Project Identity & Verified Technology Stack
Clypra is a high-performance native desktop video editor (`v1.5.9`) targeting macOS and Windows.
- **Frontend**: React 19 + TypeScript 5.8 + Vite 7 (`src/`)
- **Desktop Shell & Backend**: Tauri 2.11 + Rust 2021 edition (`src-tauri/`)
- **State Management**: Zustand v5 stores (`src/store/`)
- **GPU Compositor**: wgpu 24 + Metal (macOS) / DirectX 12 (Windows) (`src-tauri/src/wgpu_compositor/`)
- **Video Decode**: FFmpeg 8.x (via `ffmpeg-next 9` static build) + VideoToolbox HW decode (`src-tauri/src/engine/`)
- **Audio Engine**: Dual-stack — CPAL 0.18 + rtrb + wsola (`src-tauri/src/audio/`) and Web Audio API (`src/core/audio/`)
- **ML / AI**: ONNX Runtime (`ort`) + Whisper.cpp (`whisper-rs`) (`src-tauri/src/commands/`)
- **Verification Tooling**: Vitest 4, cargo test, TypeScript compiler (`tsc`)

---

## 2. Architectural Invariants (Non-Negotiable)
1. **Single Time Source**: `PlaybackClock.ts` is the sole session authority for playback position. Never create secondary clocks. Note: singleton module requires dev server restart after edits.
2. **EvaluatedScene Currency**: All render pipelines (preview, export, thumbnail, filmstrip) consume `EvaluatedScene` emitted by `evaluateTimelineSceneCached()`. Never read `timelineStore` directly in render loops.
3. **Command-Pattern Mutations**: All undoable timeline edits must be dispatched via `historyStore.dispatch(command)`. Direct store array mutations bypass undo history.
4. **Asynchronous Asset Hydration**: `MediaAsset.path` is empty (`""`) until probed. Never pass empty paths to Rust IPC. Respect `.filter(c => Boolean(c.path))` in `getActiveAudioClips()`.
5. **IPC Discipline**: Every Tauri `invoke()` has latency (0.5–2ms warm, 50–500ms cold). Never invoke IPC in `requestAnimationFrame` loops for non-essential tasks. Batch and debounce.
6. **Native Preview Surface Invariant**: The native GPU preview (Metal on macOS, DirectX 12 on Windows) is enabled by default. Default builds and dev sessions use the native hardware surface; set `VITE_CLYPRA_NATIVE_SURFACE=0` to force the WebGL/web-canvas readback fallback.
7. **Closure-Guarded Render Loop**: `NativeProgramPreview.tsx` render loop uses closure variables. Always guard mutations with epoch counters and reset `renderInFlight = false` across ALL exit paths.
8. **Export Non-Interference**: Export runs concurrently with the UI. The export pipeline must never mutate timeline or project store state.
9. **Three-Tier Compute Boundary**: Tier 1 (Main/React) for UI events; Tier 2 (Web Workers) for heavy CPU compute (waveforms, scopes, parsing); Tier 3 (Rust) for decoding, compositing, and audio hardware.
10. **Preserve Documentation & Comments**: Never delete comments or JSDoc blocks unrelated to your change.
11. **Cross-Platform Contract Discipline**: Core editing and project semantics must remain identical across macOS, Windows, and Linux. Zero OS branching in timeline math. Isolate platform differences in localized native adapters. Never assume success on one OS proves readiness on another. Consult [`docs/engineering/platform-compatibility.md`](docs/engineering/platform-compatibility.md).
12. **Zero Hardcoded User-Facing Text**: All UI labels, tooltips, dialogs, and menu items must use canonical semantic keys in `src/i18n/catalogs/en.json` and maintain 100% parity across all 9 supported locales (`npm run i18n:check`).
13. **Active Presenter Verification**: The native GPU preview is the default, with canvas/DOM readback as fallback. Never infer the active preview path solely from environment variables; verify the runtime presenter and fallback state directly.
14. **Diagnostic Logging & Privacy Invariant**: Local editor sessions accumulate append-only NDJSON logs in `perf_logs/`. Redact personal paths, machine IDs, and credentials. Never treat unaligned remote clocks as synchronized.
15. **Investigation-Only Audit Default**: Defect hunts and performance investigations operate in non-destructive read-only mode by default. Validate hypotheses with tests or empirical evidence before declaring confirmed defects.
16. **Native UI Thread Safety**: All native window, view, and OS-level UI hierarchy operations across macOS (AppKit/`NSWindow`), Windows (Win32/`HWND`), and Linux (GTK/`GtkWidget`) must execute exclusively on the main UI thread via `window.run_on_main_thread()` or `app.run_on_main_thread()`. Background tasks (Tokio workers, render loops, audio threads) must never call restricted platform APIs directly. Violation on macOS 26+ causes an immediate `EXC_BREAKPOINT (SIGTRAP)` crash. See [`.agents/skills/tauri-native-thread-safety/SKILL.md`](.agents/skills/tauri-native-thread-safety/SKILL.md).

Specialized rule files under [`.agents/rules/`](.agents/rules/) (`architecture.md`, `cross-platform.md`, `testing-and-behavior.md`, `i18n-localization.md`, `preview-performance.md`, `diagnostic-logging.md`, `engineering-standards.md`) define low-level operational constraints.

---

## 3. Implementation Standards
- **Understand Before Editing**: Trace call paths, inspect relevant Zustand stores, and check existing patterns before modifying code.
- **Minimal Coherent Changes**: Keep edits narrow. Refactor only what is strictly necessary. Do not introduce speculative abstractions.
- **Contract & Type Integrity**: Run `npx tsc --noEmit` after every modification. Zero `error TS` allowed. Do not use `any` or loose casts to suppress type errors.
- **Cross-Platform Discipline**: Enforce the 10 cross-platform implementation requirements: no implicit targets, no unverified dependencies, no Windows-only assumptions, independent multi-target release validation, compatibility in design reviews, shared semantics, maintained compatibility records, verified Tauri v2 docs, separate support from verification, and restrictive capability scopes.
- **Lifecycle & Resource Cleanup**: Explicitly handle cancellation, timeouts, unsubscriptions, Worker termination (`{ type: "DISPOSE" }`), and GPU/native handle releases.
- **Concurrency & Race Resistance**: Account for asynchronous interleaving, out-of-order responses, and stale state transitions.
- **Error Handling**: Do not mask critical errors with empty `catch` blocks. Surface actionable diagnostics and maintain graceful degradation.

---

## 4. Testing & Regression Standards
- **One Bug = One Fix + One Regression Test**: Every bug fix must include an automated regression test reproducing the original issue and guarding against regression.
- **Append-Only Preview Suite**: `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts` is an append-only regression suite (current baseline: 156 tests). Never delete or skip existing tests.
- **Meaningful Assertions**: Tests must verify externally observable behavior and state correctness, not internal mock shapes. Never write empty or tautological tests.
- **Deterministic & Isolated**: Unit tests must not depend on network access, external services, or unseeded random state.
- **Tiered Test Strategy**:
  - *Unit*: Pure timeline math, timecode calculations, state transformations, gap engine.
  - *Integration*: Store workflows, audio synchronization adapters, worker client protocols.
  - *UI & Browser E2E*: Playwright for frontend user-interface workflows with controlled Tauri mock boundaries.
  - *Native Desktop E2E*: WebdriverIO (`@wdio/tauri-service`) for native application binary verification.
  - *Rust Backend*: `cargo test` for decoder buffers, ring buffers, and cache logic.
- **Mandatory Behavior Coverage**:
  Every code change must include a risk-proportionate behavior and regression assessment before and after implementation.
  After implementing a change, independently identify additional user behaviors, boundary conditions, error cases, state transitions, concurrency risks, and platform differences relevant to that change. Add and execute meaningful automated tests for the important scenarios, using the appropriate unit, integration, Playwright UI, native desktop, media, or platform test harness.
  Do not declare a test plan, mocked integration, successful build, or unexecuted test to be proof that the real behavior works. Report the scenarios identified, the tests implemented and executed, the actual results, and any remaining verification gaps.
  A change is not fully verified merely because its happy path passes. Do not claim that every conceivable behavior has been tested; demonstrate that the important risks were systematically considered and that unresolved risks are explicit.

---

## 5. Canonical Developer & Verification Commands
`npm` is the canonical package manager for Clypra dependencies, scripts, and CI workflows. Always use the project's verified commands:
```bash
# Unified Architecture Invariants Check
npm run verify:architecture

# Fast Local Verification (Typecheck + Architecture + Preview render loop)
npm run verify:fast

# Targeted verification based on git changed files
npm run verify:changed

# Subsystem & audio integration tests
npm run verify:integration

# Media engine & timeline math regressions
npm run verify:media

# Playwright frontend browser UI tests
npm run verify:ui

# Packaged desktop application smoke validation
npm run verify:desktop

# Full comprehensive regression suite
npm run verify:full

# Rust backend tests
cargo test --manifest-path src-tauri/Cargo.toml

# Full frontend production build
npm run build

# Local dev server (web-canvas fallback)
npm run dev

# Local desktop dev server (native Metal/wgpu preview by default)
npm run tauri dev

# Local dev server with forced WebGL/web-canvas fallback
VITE_CLYPRA_NATIVE_SURFACE=0 npm run tauri dev
```

---

## 6. Definition of Done & Agent Completion Checklist
Before reporting any task complete, every agent must verify:
1. **Scope & Intent**: The problem and solution are clearly stated.
2. **Smallest Change**: Code changes are strictly scoped without accidental edits.
3. **Behavior Coverage & Traceability**: Pre- and post-implementation behavior analyzed across applicable categories (A–J); in-scope P0/P1 scenarios automated.
4. **Tests Added/Updated**: A meaningful test covers the change at the lowest-cost appropriate layer.
5. **Verification Evidence**:
   - `npx tsc --noEmit` passed with 0 errors.
   - `npm run i18n:check` passed with 100% key and placeholder parity.
   - Relevant Vitest and Playwright test files executed and passed.
   - `npm run docs:check` passed if documentation links changed.
6. **Clean Working Tree**: No untracked scratch files left in source directories.
7. **Explicit Reporting**: Document what was verified, commands executed, and any environment-dependent checks that could not run.

---

## 7. Supporting References & Skill Responsibilities
When undertaking engineering tasks, agents must automatically classify incoming requests against the **Automatic AI Engineering Orchestration Matrix** ([`docs/engineering/agent-routing.md`](docs/engineering/agent-routing.md)) and activate the smallest relevant combination of specialized skills without waiting for manual user direction.

### Mandatory internationalization skill routing
For every task that introduces, modifies, reviews, or investigates application-owned user-facing text, automatically activate [`.agents/skills/i18n-localization-engineering/SKILL.md`](.agents/skills/i18n-localization-engineering/SKILL.md) before consequential implementation or review.

This requirement applies to UI labels, tooltips, menus, forms, accessibility names, errors, notifications, dynamic messages, settings, language selection, formatting, and native Tauri text.

The developer does not need to name the skill.

Combine it with the relevant architecture, frontend, accessibility, NLE, cross-platform, behavior-testing, Playwright, and code-review skills according to the task's actual scope.

Do not load localization procedures for unrelated work that has no meaningful localization impact.

New application-owned user-facing text must follow the canonical localization architecture, and relevant changes must run the appropriate localization validation and regression tests.

### Mandatory Clypra bug-hunting workflow
For requests to discover defects, audit reliability, investigate regressions, or assess implementation correctness, automatically activate [`.agents/skills/clypra-bug-hunter/SKILL.md`](.agents/skills/clypra-bug-hunter/SKILL.md).

For non-trivial feature implementations and bug fixes, perform a risk-proportionate post-implementation bug-hunting pass before declaring the work complete.

Investigate applicable NLE semantics, state transitions, concurrency, persistence, cross-platform behavior, media processing, and user-facing failure modes. Validate important hypotheses with executable tests or clearly identified evidence.

Default to investigation-only mode unless implementation of fixes is explicitly requested. Produce findings categorized by severity, defect type, confidence, affected scope, reproduction steps, evidence, and recommended regression tests.

Never claim that the entire application is bug-free, and never present an unverified suspicion as a confirmed defect.

### Mandatory preview performance verification
When a task changes Clypra's native preview surface, DOM/canvas preview path, rendering transfer pipeline, presenter selection, or performance-sensitive playback behavior, automatically apply [`.agents/skills/clypra-preview-performance-engineering/SKILL.md`](.agents/skills/clypra-preview-performance-engineering/SKILL.md).

For meaningful preview architecture changes, verify the active runtime path, preserve equivalent rendering behavior, and collect comparative performance evidence on representative workloads where the environment permits it. Do not infer performance improvements from compilation or passing functional tests.

When benchmarking is requested, report frame pacing, interaction latency, resource costs, measurement methodology, platform scope, and remaining uncertainty. If the available environment cannot establish a reliable comparison, report that limitation instead of claiming a performance winner.

### Mandatory performance-log analysis routing
Automatically activate [`.agents/skills/clypra-performance-log-analysis/SKILL.md`](.agents/skills/clypra-performance-log-analysis/SKILL.md) whenever a task involves investigating Clypra performance logs, telemetry, profiler captures, remote diagnostics, local-versus-remote session comparisons, frame timing, performance incidents, or performance regressions.

Inspect the actual log formats and relevant source paths. Reconstruct event timelines, account for timestamp and environment differences, distinguish observations from hypotheses, and produce a professional evidence-based report.

Use the preview performance engineering skill when controlled benchmarks are needed to validate a suspected bottleneck. Use the bug-hunter skill when investigating broader functional defects.

Never fabricate metrics, treat unaligned remote clocks as directly comparable, expose sensitive diagnostic data unnecessarily, or claim a root cause without adequate evidence.

### Mandatory Clypra UI/UX engineering
For tasks involving Clypra's interface, interaction patterns, layout, design system, accessibility, or usability, automatically apply [`.agents/skills/clypra-ui-ux-engineering/SKILL.md`](.agents/skills/clypra-ui-ux-engineering/SKILL.md).

Inspect existing components, design tokens, user workflows, interaction states, and relevant product constraints before making changes. Preserve established conventions unless there is a justified improvement.

For non-trivial UI changes, consider keyboard operation, accessibility, localization, resizable desktop layouts, loading and error states, and adjacent workflow regressions.

Use component and Playwright tests for the behaviors they can verify, and native desktop tests when real Tauri integration is affected. Distinguish verified defects from subjective design preferences, and never claim successful visual or interaction validation without evidence.

### Mandatory native thread-safety engineering
For any change involving Tauri native APIs, operating-system windows, native UI objects, graphics surfaces, platform event loops, or asynchronous access to native resources, automatically apply [`.agents/skills/tauri-native-thread-safety/SKILL.md`](.agents/skills/tauri-native-thread-safety/SKILL.md).

Determine the actual thread-affinity requirements of each affected API and platform. Do not assume that all native APIs share the same threading rules.

Inspect call paths from Tokio workers and other background tasks, enforce appropriate dispatch and resource-ownership boundaries, and test lifecycle races and error handling.

Apply the relevant macOS/AppKit, Windows, Linux/GTK/WebView, and graphics-backend requirements to the platforms affected by the change.

Run platform-specific tests where the environment permits. Treat mocked tests and successful compilation as insufficient evidence of runtime thread safety.

Never claim cross-platform thread safety solely because one operating system passes.

- **`AGENTS.md`**: Universal repository invariants, engineering standards, and completion checklist.
- **`clypra-ui-ux-engineering`** ([`.agents/skills/clypra-ui-ux-engineering/SKILL.md`](.agents/skills/clypra-ui-ux-engineering/SKILL.md)): Govern design decisions, usability heuristics, WCAG 2.2 AA accessibility, interaction lifecycles, design system consistency, and desktop layout engineering.
- **`clypra-preview-performance-engineering`** ([`.agents/skills/clypra-preview-performance-engineering/SKILL.md`](.agents/skills/clypra-preview-performance-engineering/SKILL.md)): Measure, benchmark, profile, and compare native GPU surface vs. DOM/canvas fallback, frame pacing, readback costs, and latency.
- **`clypra-performance-log-analysis`** ([`.agents/skills/clypra-performance-log-analysis/SKILL.md`](.agents/skills/clypra-performance-log-analysis/SKILL.md)): Forensically analyze local/remote NDJSON session logs, telemetry rollups, traces, profiler captures, and performance incidents.
- **`clypra-bug-hunter`** ([`.agents/skills/clypra-bug-hunter/SKILL.md`](.agents/skills/clypra-bug-hunter/SKILL.md)): Adversarial defect discovery, reliability audits, regression investigations, and evidence-based findings.
- **`behavior-coverage`** ([`.agents/skills/behavior-coverage/SKILL.md`](.agents/skills/behavior-coverage/SKILL.md)): Systematic user behavior discovery, 10 scenario categories, traceability matrix, and Playwright UI / native desktop test automation.
- **`i18n-localization-engineering`** ([`.agents/skills/i18n-localization-engineering/SKILL.md`](.agents/skills/i18n-localization-engineering/SKILL.md)): Canonical semantic keys, catalog parity checks (`npm run i18n:check`), 9 first-party supported locales, locale-aware formatting, and native menu synchronization.
- **`architecture-design-review`** ([`.agents/skills/architecture-design-review/SKILL.md`](.agents/skills/architecture-design-review/SKILL.md)): Architecture assessment, boundary analysis, trade-off evaluation, and ADR creation in [`docs/architecture/adr/`](docs/architecture/adr/README.md).
- **`nle-domain-engineering`** ([`.agents/skills/nle-domain-engineering/SKILL.md`](.agents/skills/nle-domain-engineering/SKILL.md)): NLE domain knowledge, timecode math, track composition, media lifecycle, and synchronization invariants. Companion specification: [`docs/engineering/nle-architecture-and-semantics.md`](docs/engineering/nle-architecture-and-semantics.md).
- **`senior-engineer-decision-making`** ([`.agents/skills/senior-engineer-decision-making/SKILL.md`](.agents/skills/senior-engineer-decision-making/SKILL.md)): Problem framing, technical trade-offs, scope discipline, and challenging unsound requests.
- **`performance-reliability-engineering`** ([`.agents/skills/performance-reliability-engineering/SKILL.md`](.agents/skills/performance-reliability-engineering/SKILL.md)): Measurement-driven optimization, memory leak prevention, queue back-pressure, and resource lifecycles.
- **`tauri-cross-platform-engineering`** ([`.agents/skills/tauri-cross-platform-engineering/SKILL.md`](.agents/skills/tauri-cross-platform-engineering/SKILL.md)): Cross-platform contracts, WebViews (WebView2, WKWebView, WebKitGTK), native sidecars, and Three-Gate CI strategy.
- **`tauri-native-thread-safety`** ([`.agents/skills/tauri-native-thread-safety/SKILL.md`](.agents/skills/tauri-native-thread-safety/SKILL.md)): Architecture Invariant 16 — Cross-platform native window, AppKit NSWindow, Win32 HWND, and Linux GTK UI operations must execute on the main event loop via `window.run_on_main_thread()`.
- **`feature-implementation`** ([`.agents/skills/feature-implementation/SKILL.md`](.agents/skills/feature-implementation/SKILL.md)): Non-destructive UI features, new tools, and effect filter development.
- **`bugfix-regression`** ([`.agents/skills/bugfix-regression/SKILL.md`](.agents/skills/bugfix-regression/SKILL.md)): Defect diagnosis, minimal fix isolation, and automated regression test creation.
- **`code-review`** ([`.agents/skills/code-review/SKILL.md`](.agents/skills/code-review/SKILL.md)): Systematic review of PRs, diffs, concurrency bugs, and architectural boundaries.
- **`clypra-media-regression-testing`** ([`.agents/skills/clypra-media-regression-testing/SKILL.md`](.agents/skills/clypra-media-regression-testing/SKILL.md)): Media testing, gap engine verification, and EvaluatedScene assertions.
- **`release-readiness`** ([`.agents/skills/release-readiness/SKILL.md`](.agents/skills/release-readiness/SKILL.md)): Pre-release audit, packaged bundle smoke checks, and sidecar binary validation.
- **Master Engineering References**:
  - Architecture Overview: [`docs/engineering/architecture-overview.md`](docs/engineering/architecture-overview.md)
  - Architecture Invariants: [`docs/engineering/architecture-invariants.md`](docs/engineering/architecture-invariants.md)
  - Agent Routing & Skill Orchestration: [`docs/engineering/agent-routing.md`](docs/engineering/agent-routing.md)
  - Agent Evaluation Harness: [`docs/engineering/agent-evaluation.md`](docs/engineering/agent-evaluation.md)
  - Engineering Intelligence: [`docs/engineering/engineering-intelligence.md`](docs/engineering/engineering-intelligence.md)
  - Desktop vs Browser Testing: [`docs/engineering/desktop-testing-strategy.md`](docs/engineering/desktop-testing-strategy.md)
  - NLE Architecture & Semantics: [`docs/engineering/nle-architecture-and-semantics.md`](docs/engineering/nle-architecture-and-semantics.md)
  - Platform Compatibility: [`docs/engineering/platform-compatibility.md`](docs/engineering/platform-compatibility.md)
  - Testing Strategy: [`docs/engineering/testing-strategy.md`](docs/engineering/testing-strategy.md)
  - Quality System: [`docs/engineering/quality-system.md`](docs/engineering/quality-system.md)
  - AI Agent Workflow: [`docs/engineering/ai-agent-workflow.md`](docs/engineering/ai-agent-workflow.md)
  - Release Readiness: [`docs/engineering/release-readiness.md`](docs/engineering/release-readiness.md)
  - Master Dev Guide: [`.agents/skills/clypra-dev/SKILL.md`](.agents/skills/clypra-dev/SKILL.md)

