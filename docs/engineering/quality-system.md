# Clypra Engineering Quality System

## 1. Purpose of the Quality System
Clypra is a multi-tier native desktop application where multiple human engineers and autonomous AI coding agents (Google Antigravity, Kiro, Cursor, OpenAI Codex) collaborate simultaneously.
Without an explicit, deterministic quality system, development across different agents risks:
- Context fragmentation and divergent coding conventions.
- Subtle asynchronous race conditions in interactive playback and rendering.
- Masked compiler and runtime errors caused by stale builds or overly broad error catching.
- Flaky tests and unverified assertions.

The quality system establishes an objective foundation where **correctness, determinism, maintainability, fast feedback, and reproducible verification** dictate whether any proposed code change is acceptable.

---

## 2. Architecture of the Quality System

The quality system coordinates five complementary layers:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Shared Portable Agent Instructions (AGENTS.md)    │
│  - Universal rules, invariants, and canonical commands      │
│  - Provider-neutral; loaded by Antigravity, Kiro, Cursor,   │
│    Codex, and Copilot                                       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  Layer 2: Reusable Agent Skills (.agents/skills/)           │
│  - Focused workflows: feature-implementation,               │
│    bugfix-regression, code-review, media-testing, release   │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  Layer 3: Local Deterministic Scripts & Verification        │
│  - npx tsc --noEmit (strict typecheck)                      │
│  - Vitest (unit & integration tests)                        │
│  - Cargo test (Rust engine & decode tests)                  │
│  - npm run docs:check (documentation link validation)       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  Layer 4: Continuous Integration (.github/workflows/ci.yml) │
│  - Automated PR gating on clean Ubuntu & Windows runners    │
│  - Non-negotiable pass/fail enforcement                     │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  Layer 5: Controlled Release Validation                     │
│  - Sidecar auditing, MSIX staging verification              │
│  - Smoke checks prior to any distribution                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Advisory vs. Enforced Controls

To avoid reliance on self-reporting, the repository separates advisory guidance from automated, machine-enforced gates:

| Quality Control | Level | Mechanism | Enforced By |
|---|---|---|---|
| **Architectural Invariants** | Policy | `AGENTS.md`, `.agents/rules/` | Code Review & Integration Tests |
| **Type Integrity** | Enforced | `npx tsc --noEmit` | Local scripts & CI pipeline |
| **Documentation Link Integrity** | Enforced | `npm run docs:check` | Local scripts & CI pipeline |
| **Preview Render Loop Regression** | Enforced | `npx vitest run ...ProgramPreview.renderLoop.test.ts` | Append-only suite (155 tests) & CI |
| **Core Domain Unit Tests** | Enforced | `npx vitest run` | CI `test-frontend` job |
| **Rust Engine & Compositor Tests** | Enforced | `cargo test --manifest-path src-tauri/Cargo.toml` | CI `test-rust` job |
| **Cross-Platform Compilation** | Enforced | `cargo check` on Windows runner | CI `check-windows` job |
| **Production Frontend Build** | Enforced | `npm run build` | CI `build-check` job |
| **Unified Engineering Quality Gate** | Enforced | `npm run verify:gate` | Quality Gate Orchestrator & CI pipeline |
| **Playback & Concurrency Benchmark** | Enforced | `npm run benchmark:playback` | Real-media test harness & baseline gate |
| **Baseline Regression Gate** | Enforced | `npm run benchmark:compare` | Hardware baseline comparator & CI |
| **Sidecar Integrity** | Audit Gate | `node scripts/verify-sidecars.mjs` | Release validation workflow |

---

## 4. How to Extend and Maintain the System

When expanding Clypra or introducing new subsystems:
1. **Never Duplicate Canonical Rules**: Keep the root `AGENTS.md` concise. Detail subsystem-specific rules in focused skills or architecture docs.
2. **One Bug = One Regression Test**: When a bug is discovered, write an automated test in the corresponding suite before marking the issue resolved.
3. **Keep Commands Synchronized**: Ensure commands documented in `AGENTS.md`, used in skills, and executed in `.github/workflows/ci.yml` remain identical.
4. **No Blanket Suppressions**: Do not silence linter rules, disable compiler checks, or ignore failing tests. Fix the underlying invariant or update the outdated assertion with proper rationale.

---

## 5. Unified Engineering Quality Gate Orchestrator

The **Unified Quality Orchestrator** (`scripts/harness/quality-gate.mjs`) binds all verification layers into an enforceable, evidence-driven pipeline connecting every feature implementation, bug fix, and dependency upgrade:

```
                  ┌──────────────────────────────────────────────┐
                  │              Feature or Upgrade              │
                  │   New features, bug fixes, engine changes    │
                  └──────────────────────┬───────────────────────┘
                                         │
                  ┌──────────────────────▼───────────────────────┐
                  │  Unified Quality Orchestrator (verify:gate)  │
                  │ Detect affected subsystems, risks & workloads│
                  └──────────────────────┬───────────────────────┘
                                         │
        ┌───────────────────┬────────────┴───────┬───────────────────┐
        ▼                   ▼                    ▼                   ▼
┌───────────────┐   ┌───────────────┐    ┌───────────────┐   ┌───────────────┐
│  Behavioral   │   │  Performance  │    │  Concurrency  │   │  Reliability  │
│  Validation   │   │  Validation   │    │  Validation   │   │  Validation   │
│ Invariants,   │   │ TTFF, seeks,  │    │ Mixed media,  │   │ Soak tests,   │
│ tsc, i18n,    │   │ scrub pacing, │    │ bg tasks,     │   │ cancel, zero  │
│ render loop   │   │ dropped frames│    │ contention    │   │ memory leaks  │
└───────┬───────┘   └───────┬───────┘    └───────┬───────┘   └───────┬───────┘
        │                   │                    │                   │
        └───────────────────┴────────────┬───────┴───────────────────┘
                                         │
                  ┌──────────────────────▼───────────────────────┐
                  │    Evidence-Based Quality Decision Engine    │
                  │ Compare with baseline; retain reports; trends│
                  │  [ PASS ]   [ FAIL ]   [ BLOCKED ] [ SKIPPED ]│
                  └──────────────────────────────────────────────┘
```

### The 4 Mandatory Pillars:
1. **Behavioral Validation**: Architecture invariants (`check-architecture.mjs`), TypeScript compiler (`tsc --noEmit`), 9-locale parity (`check-i18n.mjs`), and the append-only preview render loop suite (`ProgramPreview.renderLoop.test.ts`).
2. **Performance Validation**: Real-media playback metrics using the Golden Project (`goldenProjectManifest.ts`): Time to first frame (TTFF), cold/warm seeks, continuous scrubbing pacing ($< 16.67\text{ms}$ budget), and dropped-frame ratio.
3. **Concurrency Validation**: Foreground playback responsiveness under competing background tasks (waveform extraction, thumbnail extraction, project serialization, export contention).
4. **Reliability Validation**: Sustained soak testing (1,000 frames), zero heap memory leaks ($< 25\text{MB}$ delta), zero orphaned FFmpeg/worker processes, rapid seek stress, and task cancellation resilience.
5. **Baseline Regression Gate**: Automated comparison against a hardware-specific versioned baseline (`scripts/benchmarks/compare-baseline.mjs`), catching latency, pacing, or memory deterioration before merging.
