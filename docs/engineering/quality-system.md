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
| **Sidecar Integrity** | Audit Gate | `node scripts/verify-sidecars.mjs` | Release validation workflow |

---

## 4. How to Extend and Maintain the System

When expanding Clypra or introducing new subsystems:
1. **Never Duplicate Canonical Rules**: Keep the root `AGENTS.md` concise. Detail subsystem-specific rules in focused skills or architecture docs.
2. **One Bug = One Regression Test**: When a bug is discovered, write an automated test in the corresponding suite before marking the issue resolved.
3. **Keep Commands Synchronized**: Ensure commands documented in `AGENTS.md`, used in skills, and executed in `.github/workflows/ci.yml` remain identical.
4. **No Blanket Suppressions**: Do not silence linter rules, disable compiler checks, or ignore failing tests. Fix the underlying invariant or update the outdated assertion with proper rationale.
