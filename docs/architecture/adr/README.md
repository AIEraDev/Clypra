# Architecture Decision Records (ADRs)

This directory contains durable Architecture Decision Records (ADRs) for Clypra.

## When to Create an ADR

An ADR must be created when an architectural decision:
- Modifies subsystem boundaries, public API interfaces, or Zustand store ownership.
- Introduces or replaces a major dependency, native library, or architectural abstraction.
- Changes project file serialization schemas or media management pipelines.
- Modifies playback coordination, GPU compositing pipelines, or audio synchronization.
- Carries significant performance, migration, or cross-platform operational risks.

Do **not** create an ADR for routine bug fixes, localized component styling, or small utility additions.

## ADR Template

New ADRs should follow this structure:

```markdown
# ADR-XXXX: [Short Title]

## Status
[Proposed | Accepted | Superseded by ADR-YYYY]

## Context & Problem Statement
- What is the observable problem or architectural requirement?
- What are the technical constraints, latency budgets, and cross-platform implications?
- What are the verified facts versus assumptions?

## Decision
- What architectural design or abstraction is being adopted?
- What are the explicit module boundaries and state ownership rules?
- How does it satisfy Clypra's Three-Tier compute boundary and core invariants?

## Alternatives Considered
- Option 1: [Description, pros, cons, rejection rationale]
- Option 2: [Description, pros, cons, rejection rationale]

## Consequences & Trade-offs
- **Positive**: [Benefits, improvements, guarantees]
- **Negative / Costs**: [Complexity, maintenance, runtime overhead]
- **Risks & Mitigations**: [Potential failure modes and handling]

## Verification & Migration Strategy
- How is the decision tested and proven? (Unit, integration, golden shaders, benchmarks)
- What is the migration path for existing project files or consumers?
- What is the rollback plan if unexpected regressions occur?
```
