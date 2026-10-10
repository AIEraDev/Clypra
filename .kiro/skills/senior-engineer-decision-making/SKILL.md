---
name: senior-engineer-decision-making
description: >-
  Guides disciplined technical decision-making, trade-off evaluations, and architectural judgment in Clypra.
  Activate when evaluating architectural alternatives, assessing technical debt, scoping complex features,
  evaluating third-party dependencies, or challenging unsound requirements.
---

# Senior Engineer Decision-Making Workflow

## Mission & Scope

This skill encodes the technical judgment, discipline, and trade-off evaluation of a Staff/Principal Software Engineer.
In a high-performance native desktop application like Clypra, engineering decisions must prioritize **correctness, determinism, maintainability, and total lifecycle cost** over novelty, premature optimization, or theoretical scalability.

This skill forces agents to establish the actual problem, inspect existing code, evaluate trade-offs, challenge assumptions, choose the simplest adequate solution, and identify failure modes before writing code.

---

## When to Activate This Skill

Activate this skill when:
- Planning non-trivial features or structural refactorings.
- Fixing complex or intermittent defects (concurrency races, memory leaks, audio/video drift, playhead glitches).
- Changing public APIs, Zustand stores, or project data models.
- Evaluating the integration or replacement of external dependencies or native tools.
- Making trade-offs involving reliability, compatibility, performance, or maintainability.
- Challenging an unsound requirement or evaluating whether a requested approach is technically viable.

## When NOT to Activate This Skill
- Trivial, localized bug fixes with obvious solutions.
- Routine UI styling or copy updates.
- Mechanical documentation or link fixes.

---

## The Required 10-Step Decision Process

Before writing code for any consequential change, work through these 10 steps:

1. **Define the Observable Problem**:
   State the problem in terms of concrete user-observable behavior and system impact:
   - *Weak*: "The audio code is messy and needs refactoring."
   - *Senior*: "When users import a video with embedded AAC audio and press play within 500ms, playback starts silently because `asset.path` is empty during database hydration, causing Rust IPC to reject the clip."
2. **Inspect Existing Code, Callers & Tests**:
   Inspect the actual implementation, callers, dependencies, and relevant tests. Trace call paths from user gesture down to the native layer.
3. **Establish Constraints & Separate Facts from Assumptions**:
   - *Verified Facts*: Backed by code, test output, or session telemetry.
   - *Assumptions*: Mark unverified assumptions explicitly (`[Assumption: requires validation on Windows]`).
4. **Identify Edge Cases & Failure Modes**:
   Anticipate rapid user interactions (scrubbing back-and-forth 10 times in 2 seconds), missing resources (offline media, disconnected audio devices), boundary conditions (empty timeline, zero-duration clips), and out-of-order asynchronous responses.
5. **Evaluate Necessity & Existing Mechanisms**:
   Ask: *Is this change actually necessary?* Can an existing store action, command, or utility solve the problem? Does fixing a localized defect require a broad refactoring, or does a narrow boundary guard suffice?
6. **Evaluate Viable Alternatives & Trade-offs**:
   When consequential, compare reasonable options against correctness, complexity, performance, testability, failure recovery, and migration cost.
7. **Choose the Least Complex Solution**:
   Choose the simplest solution that adequately and robustly meets the requirements. Never add speculative abstractions or plug-in architectures for hypothetical future needs.
8. **Identify Required Tests & Verification Evidence**:
   Define what proves correctness before writing code. Identify which automated test reproduces the defect and which suites prevent regression.
9. **Implement with Scoped Discipline**:
   Implement the chosen solution with minimal, coherent changes. Preserve existing comments, docstrings, and type contracts.
10. **Review the Final Diff**:
    Inspect `git diff` before declaring completion: check for accidental formatting changes, leftover debug statements, and unintended behavioral side-effects.

---

## Engineering Judgment Requirements

Agents must challenge their own assumptions and challenge proposed approaches when repository evidence suggests they are incorrect or unnecessarily risky.

Always apply these engineering principles:
- **Correctness Before Optimization**: Never sacrifice functional correctness or timeline invariants for speculative performance gains.
- **Explicit Contracts Over Implicit Coupling**: Use strongly typed interfaces and explicit function arguments rather than shared mutable state.
- **Clear Ownership Over Shared State**: Every piece of data belongs to exactly one Zustand store, React component, or Rust struct.
- **Compatibility & Migration Costs**: Protect existing project files from breaking changes.
- **Deterministic Error Handling**: Replace silent failures and empty `catch` blocks with actionable diagnostics and graceful degradation.
- **Concurrency & Resource Lifecycle**: Guard against out-of-order responses, handle cancellation, and release resources promptly.
- **Security & Data Integrity**: Maintain least-privilege Tauri capabilities and atomic project writes.
- **Observability & Diagnostics**: Ensure failures produce actionable error logs.
- **Total Operational & Maintenance Cost**: Consider the ongoing cognitive and maintenance burden of every new dependency or abstraction.

### Rules of Engagement:
- **Do not over-engineer** a localized feature in anticipation of hypothetical future scale.
- **Do not introduce a new abstraction** merely because a pattern is common in large frameworks.
- **Do not preserve an existing design** when it demonstrably prevents required correctness, reliability, or testability.
- **When a requested approach is unsound**, explain the specific problem and propose a better alternative that remains within the task's scope.

---

## Proportional Design Documentation

- **Ordinary Features & Fixes**: Use lightweight implementation plans in task responses or pull requests.
- **Consequential Architectural Changes**: Create a formal Architecture Decision Record (ADR) under [`docs/architecture/adr/`](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/architecture/adr/README.md) capturing Context, Decision, Consequences, and Verification.
- Do not create an ADR for every routine code edit.

---

## Definition of Done

- **Never mark an engineering task complete merely because code compiles**.
- Completion requires:
  1. Automated test verification proving correctness.
  2. Review of relevant failure paths and error handling.
  3. Clean diff review with zero accidental changes.
  4. Clear, explicit distinction between what was verified and what was assumed.
