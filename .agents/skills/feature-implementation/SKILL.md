---
name: feature-implementation
description: >-
  Guides AI agents through implementing new features and capability enhancements safely in Clypra.
  Activate when adding new UI capabilities, timeline tools, export options, effect filters, or
  core subsystems. Enforces architectural consistency, non-destructive scoping, and regression test planning.
---

# Feature Implementation Workflow

## Overview
This skill provides a structured, safe workflow for designing and implementing new features in Clypra.
Clypra is a multi-tier desktop application (React 19 + Tauri 2.x + Rust wgpu compositor). Uncontrolled feature additions can easily violate data-flow invariants, cause playhead jitter, or introduce IPC performance regressions.

---

## When to Use This Skill
- Implementing a new user-facing tool, panel, or modal.
- Adding a new clip type, transition, or effect.
- Extending timeline operations or export preset options.
- Integrating a new native backend capability or IPC command.

## When NOT to Use This Skill
- Fixing an existing bug or regression (use `bugfix-regression`).
- Reviewing existing PRs or commits (use `code-review`).
- Preparing a release candidate (use `release-readiness`).

---

## Step-by-Step Procedure

### 1. Clarify Scope and Acceptance Criteria
- Explicitly state what the feature will do and what is out of scope.
- Identify the target user interaction model and performance requirements.
- Identify whether the feature touches the preview render path, timeline state, or native engine.

### 2. Inspect Existing Architecture & Patterns
- Check `AGENTS.md` and `.agents/rules/architecture.md` for governing constraints.
- Consult `.agents/skills/clypra-dev/SKILL.md` Section 21 (*Quick Subsystem Decision Guide*).
- Inspect similar features already implemented in `src/features/` or `src/core/`.
- Never create a duplicate store, secondary playback clock, or parallel evaluation path.

### 3. Identify Subsystem Boundaries & Compute Tier
Determine where each component belongs based on the Three-Layer Rule:
- **Tier 1 (Main/React)**: UI layout, user input, dialogs, Zustand action triggers.
- **Tier 2 (Web Worker)**: Complex data transformations (>2ms), geometry calculations, curve evaluation.
- **Tier 3 (Rust Native)**: GPU shaders, video decoding, audio synthesis, disk I/O, IPC handlers.

### 4. Plan Proportional Implementation & Test Strategy
- Propose the smallest coherent change to achieve the feature.
- Plan unit tests for pure domain functions before touching state or UI.
- If timeline mutations are involved, implement them as commands in `src/core/commands/` so they support undo/redo via `historyStore`.
- If new types are needed, define them in `src/types/` and ensure backward compatibility.

### 5. Incremental Implementation
- Step 1: Types & Core Engine logic (pure TypeScript functions).
- Step 2: Zustand Store actions (if new state is required; ensure persistence rules are respected).
- Step 3: UI Components (using Clypra design tokens and Radix/Tailwind primitives).
- Step 4: IPC bridge handlers (if native functionality is needed, ensure path validation via `security.rs`).

### 6. Mandatory Mixed-Stack Benchmark, Scalability & Deep Automation Contract

Every new feature, clip type, layer capability, or subsystem upgrade must execute an automated deep verification pass to guarantee performance, latency, scalability, and cross-subsystem stability before declaring completion. This rigorous automation suite eliminates regressions and makes manual testing optional.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│               MANDATORY DEEP AUTOMATION & BENCHMARK SUITE CONTRACT                     │
├──────────────────────────┬──────────────────────────┬──────────────────────────────────┤
│ 1. Mixed-Stack Benchmarks│ 2. Scale & Concurrency   │ 3. Interference & Root Cause     │
│ Video + Music + Text +   │ Evaluate 1, 10, 50, 100+ │ Verify Audio CPAL, Preview Clock,│
│ Stickers in unison       │ concurrent instances     │ Native Presenter, GC pauses      │
├──────────────────────────┼──────────────────────────┼──────────────────────────────────┤
│ 4. Telemetry Recording   │ 5. Deep Pixel Oracles    │ 6. State & Fuzzing Oracles       │
│ Hooks to telemetry       │ PSNR ≥ 60dB / MSE ≤0.0001│ Rapid undo/redo, transaction     │
│ collector & NDJSON logs  │ golden-frame pixel diffs │ fuzzing, atomic persistence      │
└──────────────────────────┴──────────────────────────┴──────────────────────────────────┘
```

#### Requirement A: Multi-Property Mixed-Stack Benchmark Harness
- **Never evaluate features in isolation**: Benchmarking a new feature alone (e.g., testing only stickers or only text) masks real-world contention.
- **Mandatory Mixed Workload**: All performance benchmarks must evaluate the feature within a realistic production composition combining:
  1. **Video**: 4K/1080p HEVC or H.264 primary background playback.
  2. **Audio / Music**: Multi-track stereo/mono audio with active volume keyframe rubber bands.
  3. **Text & Titles**: Dynamic text layers with active typography/effects.
  4. **Stickers & Visual Overlays**: Vector Lottie or raster overlays with transforms.
  *(Reference standard: `src/benchmarks/goldenProjectManifest.ts` and `src/lib/export/__tests__/mixedStackExportParity.test.ts`)*.

#### Requirement B: High-Concurrency Scalability Stress ($1 \to 10 \to 50 \to 100+$ instances)
- **Multi-Instance Scaling Analysis**: Measure throughput and latency curves across 4 concurrency tiers:
  - **1 instance**: Baseline overhead.
  - **10 instances**: Typical production scene density.
  - **50 instances**: Complex composite scene.
  - **100+ instances**: Extreme stress / worst-case saturation boundary.
- **Required Metrics to Record**:
  - **Latency Distribution**: Frame render duration p50, p95, and max ($\text{ms}$).
  - **Frame Pacing**: Pacing variance and dropped-frame count against 60fps ($16.6\text{ms}$ budget).
  - **Memory Footprint**: Heap delta ($\Delta \text{MB}$) and GPU texture allocation over sustained loops (e.g. 5-minute / 9,000-frame simulation).
  - **Throughput**: Maximum sustained frames rendered per second (FPS).

#### Requirement C: Cross-Subsystem Interference & Root-Cause Explanation ("The Why")
When running under high concurrency (e.g., 50–100+ instances), the agent must explicitly verify and explain the impact on neighboring subsystems:
1. **Audio Engine Stability (CPAL / rtrb / wsola)**:
   - Does high layer density starve the real-time audio callback thread ($< 5.3\text{ms}$ buffer budget at $48\text{kHz}$)?
   - Verify zero buffer underruns, zero audible clicks, and zero AV desynchronization or drift.
2. **Video Decoder & Playhead Authority (`PlaybackClock.ts`)**:
   - Does layer rasterization or compositing block the main event loop, causing seek stutter or clock desynchronization?
   - Verify that `PlaybackClock.ts` remains the uncompromised single time authority (Architecture Invariant 1).
3. **Compositor & Presenter Selection**:
   - Does layer overhead cause the native GPU presenter (Metal/DirectX) to bail out or fall back to DOM/WebGL canvas readbacks (`sticker-or-raster-unsupported`)?
   - Verify that the native preview hardware surface remains active unless explicitly unsupported.
4. **Main Thread Event Loop & V8 Garbage Collection**:
   - Do per-frame object or buffer allocations trigger V8 Major GC pauses ($> 16\text{ms}$ jank)?
5. **Root-Cause Analysis ("Why is it fast or slow?")**:
   - If performance scales sub-linearly or degrades under stress, document the physical constraint (e.g. CPU Web Worker IPC serialization cost, GPU memory bandwidth/fill rate, main-thread layout thrashing, or texture cache misses) and implement the appropriate mitigation (instancing, memory pooling, Worker offloading).

#### Requirement D: Production Telemetry Instrumentation
- Every new capability, layer type, or pipeline stage must instrument telemetry:
  - Register with `telemetryCollector` to record metrics into Clypra's append-only NDJSON session logs (`perf_logs/`).
  - Track: execution duration per frame, cache hit/miss ratio, GPU texture allocations, and fallback occurrences.
  - Automated tests must assert that telemetry events are correctly emitted with appropriate tags and payload shapes.

#### Requirement E: Deep Mathematical & Behavioral Verification Oracles (Zero-Manual QA)
Manual clicking cannot detect subtle sub-pixel drift, color banding, or audio phase corruption. Automated mathematical oracles are mandatory:
1. **Golden-Frame Pixel Oracles**:
   - Utilize `computePixelDiff()` from `src/lib/renderEngine/pixelDiff.ts`.
   - Compare Preview vs. Export renders across multiple sampled timestamps ($t = 0, 0.25d, 0.5d, 0.75d, d$).
   - Enforce Peak Signal-to-Noise Ratio $\text{PSNR} \ge 60\text{ dB}$ (or $\infty\text{ dB}$ for exact matches), Mean Squared Error $\text{MSE} \le 0.0001$, and 0 unexplained differing pixels.
2. **Audible Signal & RMS Oracles**:
   - Verify audio processing using physical CoreAudio/CPAL test harnesses or RMS energy assertions to ensure non-zero, non-clipped, drift-free output.
3. **Timeline State & Command Fuzzing**:
   - Verify transactional mutations via `historyStore.dispatch(command)` under rapid undo/redo cycles, edge-case boundary trimming (t=0, t=clipEnd), and atomic project save/reopen fidelity.

---

### 7. Verify Local Quality Gates
Run the canonical verification suite:
```bash
# Ensure strict type safety
npx tsc --noEmit

# Run unit and integration tests for new/affected code
npx vitest run <path/to/feature.test.ts>

# Run core preview render loop regression suite
npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts

# Run Rust tests if native code was changed
cargo test --manifest-path src-tauri/Cargo.toml

# Run internationalization catalog parity
npm run i18n:check
```

### 8. Inspect Diff & Report Completion
- Run `git diff` to confirm zero unrelated changes, temporary debug logs, or commented-out code.
- Report:
  - Exact files created or modified.
  - Behavior implemented and verified across multi-property workloads.
  - Benchmark & scalability results (p50/p95 latency, 1 vs 10 vs 50 vs 100 instances, memory stability, interference analysis).
  - Deep verification oracle results (PSNR/MSE pixel diffs, audio RMS, undo/redo fuzzing).
  - Telemetry instrumentation added.
