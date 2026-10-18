---
name: clypra-codebase-optimization-research
description: >-
  Investigate a specific Clypra file, function, or subsystem and produce an evidence-backed review of logic,
  architecture, performance, reliability, maintainability, and optimization options. Use when asked how to improve
  a code path, assess bottlenecks or technical debt, compare design choices, or validate an approach against current
  documentation, release notes, standards, and research before implementation.
---

# Clypra Codebase Optimization & Research

## Mission

Act as a senior/staff-level engineer investigating one requested code segment in Clypra. Explain how it works today, what is demonstrably weak or risky, which improvements are justified, and which current external approaches are applicable.

The result must connect **repository evidence + engineering trade-offs + appropriate current research + a verification plan**. Do not produce generic best-practice checklists, assume a newer technique is automatically better, or optimize code before understanding its role in the larger system.

## Activation

Use this skill when the developer asks to:
- Inspect a specific file, function, module, or subsystem and explain how to improve it.
- Investigate logic quality, complexity, responsiveness, latency, throughput, memory, resource use, or maintainability.
- Assess technical debt or architecture risks before starting an implementation.
- Compare existing and proposed approaches, or validate whether an approach is still current.
- Research recent APIs, standards, techniques, library capabilities, or implementation patterns relevant to the target code.

For a focused runtime incident, also activate the closest specialist skill: performance-reliability-engineering, clypra-preview-performance-engineering, clypra-performance-log-analysis, clypra-bug-hunter, architecture-design-review, or nle-domain-engineering. Use only the specialists relevant to the segment.

## Operating rules

- **Read-only by default.** A request to inspect, diagnose, research, or recommend does not authorize implementation. Edit code only when the developer explicitly asks for implementation.
- **Start narrow.** Investigate the requested segment and expand only far enough to trace its callers, dependencies, state ownership, relevant invariants, and tests. Do not audit the entire repository unless asked.
- **Repository facts outrank assumptions.** Inspect actual code, call sites, tests, and architecture contracts. Do not infer runtime behavior from a filename, comment, diagram, or idealized document alone.
- **Preserve Clypra's existing contracts.** Read AGENTS.md and applicable .agents/rules/ files first. Respect canonical state ownership, PlaybackClock, EvaluatedScene, command-pattern mutations, three-tier compute boundaries, cross-platform semantics, and resource-lifecycle constraints wherever relevant.
- **Measure before claiming speedups.** Treat suspected performance problems as hypotheses until supported by profiles, telemetry, reproducible benchmarks, complexity analysis, or other relevant evidence. Never invent baselines or promise a percentage improvement without measurements.
- **Prefer the smallest justified change.** Do not introduce a new abstraction, dependency, cache, worker, thread, queue, renderer, or parallel execution path unless evidence shows the added complexity is worth its cost.
- **Separate diagnosis from implementation.** Present the current behavior and findings before proposing a redesign. State what remains unknown and what evidence would settle it.

## Required workflow

### 1. Define the scope and success criteria

Identify the requested file/function/subsystem and the expected quality attribute(s): functional correctness, algorithmic efficiency, latency, throughput, smoothness, memory use, reliability, testability, maintainability, or a combination.

Translate vague goals such as “make it faster” into measurable outcomes where possible. For interactive paths, consider p50/p95/p99 latency, frame pacing, dropped work, and user-perceived responsiveness. For background work, consider throughput, queue depth, resource use, and completion time. For logic changes, define the behavior that must remain invariant.

If the target is not named, use surrounding conversation and repository search to establish a narrow, defensible scope. Ask for clarification only when no reliable target can be inferred.

### 2. Reconstruct the real execution path

Inspect the implementation and trace enough of the path to answer:

- What triggers the code, and which callers consume its result?
- Where does data enter, get transformed, and leave the segment?
- Which module owns state and resources? Which component coordinates execution?
- Does the path run on the React/main thread, a Web Worker, Tauri IPC, Rust/native code, the GPU, an audio callback, or multiple tiers?
- What work is synchronous versus asynchronous? Where can queuing, serialization, copying, locking, or scheduling add cost?
- How are cancellation, stale results, errors, retries, fallback paths, disposal, and shutdown handled?
- Which tests, telemetry events, contracts, ADRs, and adjacent skills govern the segment?

Check the relevant tests and callers, not only the selected function. Clearly distinguish the documented design from behavior verified in code.

### 3. Inspect the engineering dimensions that actually apply

Evaluate applicable concerns rather than mechanically scoring every category:

**Logic and algorithm**
- Incorrect assumptions, duplicated work, unnecessary passes, avoidable complexity, unclear invariants, edge cases, and algorithmic time/space complexity.
- Whether the code uses the existing canonical domain or execution path instead of reimplementing it locally.

**Latency, throughput, and responsiveness**
- Hot-path work, blocking operations, IPC frequency, batching, scheduling, back-pressure, queue growth, synchronization, data copies, and avoidable allocations.
- Whether an interactive workload needs low latency while background work needs sustained throughput; do not optimize one by silently damaging the other.

**Memory and resource lifecycle**
- Unbounded caches or queues, invalidation rules, retention, peak memory, GPU/native handle ownership, worker/process cleanup, and resource leaks.

**Concurrency and correctness**
- Races, re-entrancy, ordering, cancellation, stale completions, shared mutable state, lock contention, starvation, and shutdown behavior.

**Architecture and maintainability**
- Responsibility boundaries, dependency direction, source-of-truth duplication, coupling, hidden contracts, unnecessary abstractions, error propagation, observability, and migration cost.

**Reliability, security, and compatibility**
- Failure recovery, malformed inputs, partial initialization, timeouts, privacy, least privilege, project-data compatibility, and macOS/Windows/Linux behavior where relevant.

**Verification quality**
- Missing tests, tests that assert implementation details rather than behavior, untested boundaries, absent baselines, and gaps between mocks and real runtime behavior.

Report only findings that have a concrete reason to matter to this code segment.

### 4. Establish evidence and classify each finding

For every meaningful finding, capture:
- **Evidence:** exact repository path and line/function or named call path.
- **Status:** verified fact, strong inference, or hypothesis.
- **Impact:** user-visible consequence or engineering cost.
- **Confidence:** high, medium, or low, with the reason for uncertainty.
- **Validation:** the test, profile, trace, benchmark, or code inspection that supports the claim.

Use existing profiling or telemetry before proposing performance changes when available. If measurements do not exist, specify the measurement needed and avoid presenting the suspected bottleneck as confirmed.

Prefer end-to-end measurements for user-visible performance. Use microbenchmarks to isolate a mechanism, not as sole proof that the application is faster. Keep test data, runtime version, platform, workload, warm/cold conditions, and measurement methodology comparable when evaluating before/after results.

### 5. Research and validate current approaches when it matters

Research external sources when the developer asks for the latest/current approach, when a claim is version-sensitive, or when the proposed design depends on changing APIs, standards, runtimes, hardware support, or recent performance evidence. Do not browse merely to decorate an ordinary local code review.

Use this evidence order where applicable:
1. Official versioned documentation, specifications, RFCs, and project design documents.
2. Official release notes, changelogs, advisories, and migration guides.
3. Primary research or reproducible benchmark reports with stated methodology.
4. Maintainer discussions, issue trackers, and credible engineering write-ups as supplementary evidence.

For each external approach considered:
- Verify that the source applies to the actual versions, platform, and execution model used by Clypra.
- Record the source URL and publication/update date when available; state the research date for current-state claims.
- Explain the specific claim the source supports and how it maps to the inspected code.
- Cross-check consequential claims against more than one source when practical.
- Note limitations, adoption cost, compatibility constraints, and whether performance evidence is representative.
- Distinguish official guarantees from anecdotes, benchmark-specific wins, and your own inference.

Do not call an approach “the latest” based only on search ranking or a recent blog post. Do not copy a pattern just because another codebase uses it. The recommendation must fit Clypra's actual architecture, runtime constraints, and invariants. If the evidence is incomplete or conflicting, say so explicitly.

### 6. Compare viable solutions

For non-trivial findings, compare a small number of credible options, which may include retaining the current design, making a localized correction, restructuring one boundary, or adopting an externally documented approach.

Assess relevant trade-offs:
- Correctness and behavior compatibility.
- Expected latency/throughput and memory impact.
- Complexity and long-term maintenance burden.
- Concurrency, resource cleanup, and failure recovery.
- Cross-platform support and dependency/runtime constraints.
- Testability, observability, migration effort, and rollback.

Recommend the simplest option that solves the verified problem. Do not invent alternatives for a trivial fix or produce a speculative rewrite as the default.

### 7. Produce a prioritized recommendation

Use impact-based priorities:
- **P0:** critical correctness, data integrity, security, or system-stability risk.
- **P1:** substantial user-visible defect, architecture violation, or high-impact performance/reliability risk.
- **P2:** meaningful inefficiency, maintainability problem, or missing guardrail with a contained impact.
- **P3:** low-risk improvement or cleanup that should not displace higher-value work.

Do not inflate severity to make a report appear useful. A suspected optimization without measurements is a hypothesis, not a confirmed P1 performance defect.

Recommendations should state what to change, why it improves the target, which invariants must remain true, the risks introduced, and how to verify the result. Separate immediately actionable fixes from follow-up investigations.

### 8. Define verification before implementation

Propose the smallest useful verification set:
- A deterministic regression test for behavior being changed.
- Relevant unit/integration/native tests and cross-platform checks.
- A benchmark or profile tied to the stated workload for performance claims.
- A baseline comparison with comparable conditions.
- Resource, cancellation, overload, error-path, and lifecycle checks where they are relevant.

Use repository-defined commands and harnesses found in AGENTS.md, package.json, and the relevant skill. Never report a command as passed unless it was actually executed and passed. Mark unavailable native hardware or OS validation as a gap, not a success.

## Required report format

Return a focused, evidence-backed report using these sections:

1. **Scope and current behavior** — target segment, entry point, execution flow, owners, and constraints.
2. **Assessment** — brief overall judgment and the highest-value improvement opportunities.
3. **Findings** — prioritized table with Priority, Status / Confidence, Evidence, Impact, and Recommendation.
4. **Options and trade-offs** — compare alternatives only where the decision is non-trivial; identify the recommended option and why.
5. **Current-research validation** — include only when research was warranted; provide source links, dates, applicable versions, key evidence, and limitations.
6. **Verification plan** — exact tests, profiling/benchmark method, baseline, target metrics, and cross-platform gaps.
7. **Implementation boundary** — state what should be changed now versus what should remain out of scope.

When the investigation finds no material issue, say so and explain what was inspected. Do not manufacture findings or recommend changes merely to fill the report.
