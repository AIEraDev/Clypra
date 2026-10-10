# Clypra — Testing & Behavior Coverage Rules
# Loaded automatically from .agents/rules/ by all agent tools.
# Supplements AGENTS.md, .agents/skills/behavior-coverage/SKILL.md, and docs/engineering/desktop-testing-strategy.md.

## 1. Mandatory Dual-Pass Behavior Discovery
- Before and after implementing any non-trivial change, systematically evaluate user behavior across applicable categories:
  - **Category A**: Core Happy Path & User Journey
  - **Category B**: Boundary & Edge Values (0s, max timeline bounds, 1-frame clips)
  - **Category C**: Error Handling & Graceful Degradation
  - **Category D**: State Machine Transitions & Mode Switching
  - **Category E**: Concurrency & Race Conditions (rapid scrub, seek during play)
  - **Category F**: Data Persistence & Schema Migration
  - **Category G**: Cross-Platform & WebView Variations
  - **Category H**: Media Lifecycle & Missing Asset Handling
  - **Category I**: Accessibility, Keyboard & Focus Navigation
  - **Category J**: Internationalization & Non-Latin String Handling

## 2. Multi-Tier Test Discipline
Assign every test to the lowest-cost appropriate layer:
- **Tier 1 — Unit Tests (Vitest)**: Pure timeline mathematics, SMPTE calculations, store reducers, gap engine logic. Fast and isolated.
- **Tier 2 — Subsystem Integration (Vitest)**: Multi-store workflows, audio sync adapters, worker message protocols.
- **Tier 3 — Frontend Browser UI (Playwright)**: UI workflows, modals, toolbar interactions, and keyboard navigation tested in browser mode with mock Tauri IPC (`tests/e2e/`).
- **Tier 4 — Native Desktop E2E (WebdriverIO)**: Native desktop binary verification on real OS surfaces using `@wdio/tauri-service`.
- **Tier 5 — Rust Backend Tests (`cargo test`)**: Native audio ring buffers, decoder pipelines, wgpu compositors, and property-based tests.

## 3. Append-Only Preview Suite Invariant
- `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts` is an append-only regression suite (current baseline: **156 tests**).
- Never delete, skip, or comment out an existing test in this suite.
- Every preview or render-loop fix must append a new `describe("Bug N — Title", () => { ... })` block reproducing the defect and validating the resolution.

## 4. One Bug = One Fix + One Regression Test
- Every bug fix must include an automated regression test reproducing the original issue and guarding against future regression.
- Tests must assert externally observable behavior and state correctness, not internal mock implementation details.

## 5. Evidence Standards
- Never declare a test plan, build success, or unexecuted test as proof of functionality.
- Always execute tests and report exact test counts, pass rates, and remaining unverified risks.
