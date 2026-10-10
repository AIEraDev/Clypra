---
name: architecture-design-review
description: >-
  Guides architectural decisions, cross-subsystem boundaries, and structural changes in Clypra.
  Activate when changing module boundaries, public interfaces, store ownership, asynchronous coordination,
  project persistence schemas, or proposing significant refactorings.
---

# Architecture Design and Review Workflow

## Mission & Scope

Clypra is a multi-tier native desktop application spanning a React 19 UI (Tier 1), Web Worker algorithmic compute (Tier 2), and a native Rust/wgpu/CPAL engine (Tier 3).
Architectural decisions carry significant risks: introducing playhead jitter, state corruption, IPC bottlenecks, resource exhaustion, or breaking synchronization between interactive preview and background export.

This skill guides coding agents through disciplined, evidence-based architectural design and review. It ensures that changes respect existing architectural invariants, establish clear ownership, and evaluate trade-offs before implementation.

---

## When to Activate This Skill

Activate this skill whenever a task:
- Changes module boundaries, public interfaces, or dependency relationships.
- Introduces a new subsystem, major dependency, or architectural abstraction.
- Modifies project serialization, media management, playback coordination, rendering, or asynchronous execution.
- Crosses multiple major subsystems (e.g., Zustand store $\leftrightarrow$ Web Worker $\leftrightarrow$ Tauri IPC $\leftrightarrow$ Rust engine).
- Creates significant compatibility, migration, performance, or operational risks.
- Proposes a substantial refactor or a replacement for an existing implementation.

## When NOT to Activate This Skill
- Localized UI component styling, layout tweaks, or copy changes.
- Isolated bug fixes that conform to established subsystem invariants (use `bugfix-regression`).
- Routine test additions or fixture updates (use `clypra-media-regression-testing`).

---

## The Required 6-Step Workflow

### Step 1 — Understand the Existing Architecture
1. **Inspect Actual Code & Data Flows**: Inspect the relevant implementations, callers, dependencies, state ownership, data flows, and existing architectural decisions.
2. **Identify Ownership**:
   - Which module owns the data? (e.g., `timelineStore` owns tracks/clips, `projectStore` owns disk persistence, `PlaybackClock` owns playback time).
   - Which module coordinates operations? (e.g., `historyStore` coordinates undoable commands, `ProjectSession` manages worker lifecycles).
3. **Verify the Real Dependency Graph**: Never propose an architecture based solely on folder names or aspirational documentation. Verify the actual dependency graph, execution paths, and compute tier boundaries.

### Step 2 — Define the Engineering Problem
Clearly distinguish and document:
- **Observed Problem**: The concrete symptom or limitation in current behavior.
- **Root Cause**: The verified upstream flaw causing the problem, if established.
- **Functional Requirements**: Exactly what the system must accomplish.
- **Non-Functional Requirements**: Latency budgets (e.g. $<2\text{ms}$ on main thread, $<12\text{ms}$ for scopes), memory bounds, zero-copy preservation.
- **Existing Constraints**: Invariants that must be preserved (e.g., `EvaluatedScene` as canonical rendering currency).
- **Assumptions vs Facts**: Explicitly mark unverified assumptions.
- **Explicitly Out-of-Scope**: What is intentionally NOT being changed.

### Step 3 — Evaluate Alternatives
For significant decisions, compare reasonable options against relevant criteria:
- **Correctness & Behavioral Compatibility**: Does it preserve existing user workflows and project integrity?
- **Complexity & Long-Term Maintenance**: Does the abstraction justify its maintenance surface?
- **Performance & Resource Utilization**: Does it avoid blocking the main thread or causing excessive allocations?
- **Testability & Observability**: Can the subsystem be tested with pure, deterministic inputs without mocking the entire app?
- **Concurrency & Lifecycle Management**: Does it handle cancellation, stale results, and resource release cleanly?
- **Failure Recovery**: How does the system recover from unexpected faults or timeouts?
- **Migration Cost**: Can existing projects open cleanly? Can the change be safely rolled back?
- **Dependency & Operational Cost**: What are the runtime, build, and maintenance costs of new dependencies?
- **Cross-Platform Feasibility**: Does it maintain consistent semantics across macOS, Windows, and Linux? (Consult [`docs/engineering/platform-compatibility.md`](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/engineering/platform-compatibility.md)).

*Rules*:
- Do not manufacture artificial alternatives for trivial changes.
- Do not automatically choose a more sophisticated architecture simply because it appears more scalable.

### Step 4 — Define Responsibility and Ownership
For proposed subsystems, explicitly specify:
- **Single Primary Responsibility**: What is its one job?
- **Inputs and Outputs**: Strongly typed interfaces in `src/types/`.
- **State Ownership**: Where does its state live? (Persisted in project vs ephemeral in session).
- **Public Interfaces**: Minimal, cohesive method signatures.
- **Dependencies & Prohibited Dependencies**: e.g., Web Workers must never import React or invoke Tauri IPC; render loops must never read `timelineStore` directly.
- **Error Propagation**: How errors are caught, transformed, and reported to the user.
- **Cancellation Semantics**: How in-flight tasks are aborted.
- **Resource Ownership & Cleanup**: How buffers, textures, worker processes, and file handles are disposed.
- **Testing Boundaries**: How the subsystem is verified in isolation.

*Avoid*: Circular dependencies, duplicated business logic, unbounded orchestration layers, global mutable state, and speculative abstractions with no demonstrated benefit.

### Step 5 — Establish Invariants and Failure Behavior
Identify the conditions that must remain true during normal operation, concurrency, cancellation, and failure:
- **Unavailable Dependencies**: What happens when native audio, hardware video decode, or an external tool is missing or fails?
- **Invalid Inputs**: How are corrupt project files, zero-duration clips, or malformed timecodes handled?
- **Timeouts & Deadlocks**: How are hanging background processes or IPC calls bounded?
- **Stale Asynchronous Results**: How does the system reject out-of-order responses when the user rapidly scrubs while a frame is decoding?

### Step 6 — Plan Migration and Verification
1. **Affected Consumers**: Identify all components reading or writing the affected interfaces.
2. **Schema & Compatibility**: If project serialization changes, provide explicit migration functions with backwards-compatibility tests.
3. **Architecture Decision Record (ADR)**: For consequential or difficult-to-reverse decisions, create an ADR in [`docs/architecture/adr/`](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/architecture/adr/README.md) documenting:
   - Status (Proposed, Accepted, Superseded)
   - Context & Problem Statement
   - Decision & Alternatives Considered
   - Consequences & Trade-offs
   - Verification Strategy & Rollback Considerations
4. **Smallest Coherent Implementation**: Keep the initial implementation as small as possible while satisfying the verified requirements.

---

## Architectural Enforcement in Clypra

- **Documentation for Intent**: Use [`docs/engineering/architecture-overview.md`](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/engineering/architecture-overview.md), [`docs/engineering/nle-architecture-and-semantics.md`](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/engineering/nle-architecture-and-semantics.md), and ADRs to capture intended designs.
- **Code Boundaries for Constraints**: Enforce isolation via TypeScript compiler contracts, separate worker scripts, and Rust crate boundaries.
- **Automated Verification**: Enforce invariants mechanically through CI tests (`tsc --noEmit`, Vitest, Cargo).
- **Descriptive Honesty**: Never document an aspirational design as if it already exists. Describe the delta between current and target architecture explicitly.
- **No Unwarranted Tooling Overhead**: Do not add a repository-wide dependency-rule framework unless the codebase's size and structure justify it.
