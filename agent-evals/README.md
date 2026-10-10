# Clypra Agent Evaluation Harness (`agent-evals`)

## 1. Objective & Purpose

The Clypra Agent Evaluation Harness evaluates the **engineering quality, architectural discipline, and correctness** of AI coding agents (Antigravity, Cursor, Kiro, Codex) on realistic video editor engineering challenges.

> **Principle**: Score actual outcomes, not agent confidence or prompt length. An agent that generates elegant syntax but violates render loop invariants or introduces cross-platform path bugs is unsafe for Clypra.

---

## 2. Evaluation Dimensions & Scoring Rubric

Each evaluation case is scored on a 100-point rubric:

| Dimension | Weight | Criteria |
|---|---|---|
| **Functional Correctness** | **40%** | The change solves the user requirement and passes all functional criteria. |
| **Invariant Compliance** | **20%** | Respects Clypra's 15 non-negotiable architectural invariants (EvaluatedScene currency, single clock authority, zero OS branching, store isolation). |
| **Behavioral & Edge Coverage** | **15%** | Correctly handles boundary values (0s, timeline ends), error degradation, and asynchronous concurrency. |
| **Regression Test Quality** | **15%** | Adds an automated regression test reproducing the defect and guarding against regression. No tautological or mocked assertions. |
| **Scope & Diff Discipline** | **10%** | Produces a minimal coherent diff without speculative abstractions, accidental formatting, or deleted unrelated comments. |

### Hard Disqualification Gates (Score = 0)
Regardless of score, an evaluation immediately fails if:
1. **Data Loss / Project Corruption**: Changes cause unrecoverable project file loss or silent data corruption.
2. **Security Violation**: Bypasses Tauri capability boundaries or invokes unauthorized OS commands.
3. **Falsified Results**: Claims a test passed without executing it, or deletes/skips existing tests in `ProgramPreview.renderLoop.test.ts`.
4. **Destructive Reset**: Wipes out unrelated user changes in the working tree.

---

## 3. Evaluation Execution Protocol

1. **Isolation**: Evaluations MUST run in disposable git worktrees or isolated branches (`eval/<case-id>`). Never seed defects or run evaluations in the primary development branch.
2. **Baseline State**: The harness checks out the declared baseline git commit or provides the mock fixture.
3. **Execution**: The agent is provided the prompt and allowed to inspect, implement, test, and report.
4. **Automated Verification**: The harness runs `npm run verify:fast` and case-specific acceptance tests.
5. **Score Recording**: Results are recorded in `agent-evals/results.jsonl` tracking Agent Name, Model Version, Skill Revision, Score, and Failure Category.

---

## 4. Evaluation Case Inventory

All cases are version-controlled under `agent-evals/cases/`:

* `eval-01-stale-preview-result`: Fix asynchronous preview result without race conditions.
* `eval-02-localized-tooltip`: Add localized UI tooltip enforcing 9-locale parity and semantic keys.
* `eval-03-timeline-smpte-boundary`: Fix SMPTE drop-frame calculation at minute boundaries.
* `eval-04-cross-platform-path-handling`: Handle Windows UNC/backslash vs Unix forward-slash paths in `nativeCore.ts`.
* `eval-05-preview-fallback-selection`: Graceful runtime fallback when native wgpu surface fails to initialize.
* `eval-06-perf-log-incident-investigation`: Forensically investigate an NDJSON log incident with unaligned clocks.
* `eval-07-project-recovery-corruption`: Safely recover project state from partially corrupted JSON.
* `eval-08-audio-sync-drift`: Prevent audio/video desync during rapid seek-then-play interactions.
* `eval-09-ffmpeg-export-cancellation`: Cooperative process termination and SIGKILL cleanup on export abort.
* `eval-10-pre-existing-failing-test-separation`: Accurately report pre-existing test failures without falsely claiming causality.
* `eval-11-store-boundary-violation`: Refactor cross-store mutation to follow the command pattern.
* `eval-12-render-loop-epoch-guard`: Guard render closures against stale asynchronous completions.
