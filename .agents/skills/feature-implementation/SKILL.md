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

### 6. Verify Local Quality Gates
Run the canonical verification suite:
```bash
# Ensure strict type safety
npx tsc --noEmit

# Run unit tests for new/affected code
npx vitest run <path/to/feature.test.ts>

# Run core preview render loop regression suite
npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts

# Run Rust tests if native code was changed
cargo test --manifest-path src-tauri/Cargo.toml
```

### 7. Inspect Diff & Report Completion
- Run `git diff` to confirm zero unrelated changes, temporary debug logs, or commented-out code.
- Report:
  - Exact files created or modified.
  - Behavior implemented and verified.
  - Tests added and their execution results.
  - Any known limitations or follow-up tasks.
