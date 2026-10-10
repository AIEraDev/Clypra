# AI Agent Engineering Workflow & Multi-Agent Standard

## 1. Multi-Agent Development Principles
Clypra is actively developed using multiple AI coding agents, including **Google Antigravity**, **Kiro**, **Cursor**, and **OpenAI Codex**.
Because developers switch between these agents on the same repository, our engineering workflow guarantees that:
- Instructions are **canonical and version-controlled**, not dependent on undocumented conversational chat histories.
- Every agent operates under the **same architectural invariants and completion criteria**.
- Automated checks and CI enforce code quality **objectively and independently of the AI host**.

---

## 2. Canonical Configuration & Host Discoverability

| Configuration Layer | File Location | Purpose & Host Support |
|---|---|---|
| **Canonical Instructions** | `AGENTS.md` | Primary rules, invariants, and commands. Automatically loaded by Antigravity, Kiro, Cursor, Codex, and Copilot. |
| **Architectural Rules** | `.agents/rules/architecture.md` | Low-level rules on Zustand stores, render loop closures, and asset hydration. |
| **Cross-Platform Rules** | `.agents/rules/cross-platform.md` | Tauri v2 multi-target discipline, WebView engine parity, path handling, sidecars. |
| **Testing & Behavior Rules** | `.agents/rules/testing-and-behavior.md` | Dual-pass behavior coverage, testing tier boundaries, append-only suites. |
| **i18n Localization Rules** | `.agents/rules/i18n-localization.md` | Zero hardcoded strings, 9-locale parity, semantic keys, locale-aware formatting. |
| **Preview Performance Rules** | `.agents/rules/preview-performance.md` | Presenter verification, frame pacing budgets, hot-path zero-overhead. |
| **Diagnostic Logging Rules** | `.agents/rules/diagnostic-logging.md` | Forensic session log analysis, clock skew handling, sensitive data protection. |
| **Engineering Standards Rules** | `.agents/rules/engineering-standards.md` | Senior engineer scope discipline, minimal coherent diffs, investigation mode. |
| **Worker Compute Rules** | `.kiro/steering/web-worker-architecture.md` | Steering rules defining compute tier boundaries. |
| **Cursor Rule Adapter** | `.cursor/rules/clypra.mdc` | Minimal Cursor adapter pointing to `AGENTS.md`. |
| **Kiro Steering Adapter** | `.kiro/steering/clypra-agents.md` | Minimal Kiro steering adapter pointing to `AGENTS.md`. |
| **Agent Skills** | `.agents/skills/<name>/SKILL.md` | Standard Agent Skills format with YAML frontmatter. |

---

## 3. Reusable Agent Skills Index & Responsibilities

When starting a task, agents should activate the smallest relevant combination of specialized skills:

| Task Type | Recommended Skill | When to Activate | Primary Responsibility |
|---|---|---|---|
| **Architecture Design & Review** | [`architecture-design-review`](../../.agents/skills/architecture-design-review/SKILL.md) | Boundaries, public interfaces, major refactorings, ADR formulation. | Architecture assessment and decision-making workflow. |
| **NLE Domain Engineering** | [`nle-domain-engineering`](../../.agents/skills/nle-domain-engineering/SKILL.md) | Timecode math, timeline semantics, audio graphs, asset hydration, export. | Domain knowledge and NLE-specific constraints. Companion: [`nle-architecture-and-semantics.md`](nle-architecture-and-semantics.md). |
| **Senior Engineer Decision-Making** | [`senior-engineer-decision-making`](../../.agents/skills/senior-engineer-decision-making/SKILL.md) | Problem framing, trade-offs, scope discipline, challenging unsound requests. | Problem framing, trade-offs, and implementation discipline. |
| **Performance & Reliability** | [`performance-reliability-engineering`](../../.agents/skills/performance-reliability-engineering/SKILL.md) | Latency budgets, memory leaks, IPC throughput, worker queues, profiling. | Measurement-driven optimization and resource reliability. |
| **Preview Performance** | [`clypra-preview-performance-engineering`](../../.agents/skills/clypra-preview-performance-engineering/SKILL.md) | Native GPU vs. canvas/bridge preview, frame pacing, readbacks, benchmarks. | Controlled benchmark comparison, end-to-end latency, and bottleneck diagnosis. |
| **Performance Log Analysis** | [`clypra-performance-log-analysis`](../../.agents/skills/clypra-performance-log-analysis/SKILL.md) | Local/remote session logs, NDJSON telemetry, traces, latency spikes, incidents. | Forensic timeline reconstruction, cross-session correlation, and root-cause analysis. |
| **Cross-Platform Engineering** | [`tauri-cross-platform-engineering`](../../.agents/skills/tauri-cross-platform-engineering/SKILL.md) | Tauri v2 webviews, native sidecars, multi-OS CI gates, platform paths. | Cross-platform compatibility and 3-gate release validation. Companion: [`platform-compatibility.md`](platform-compatibility.md). |
| **Adversarial Bug Hunting** | [`clypra-bug-hunter`](../../.agents/skills/clypra-bug-hunter/SKILL.md) | Defect discovery, reliability audits, regression investigations, edge cases. | Adversarial quality assessment, defect discovery, and evidence-based reporting. |
| **Behavior Coverage & Testing** | [`behavior-coverage`](../../.agents/skills/behavior-coverage/SKILL.md) | User journeys, boundary conditions, Playwright UI, native test mapping. | Systematic scenario mapping and multi-tier behavior verification. |
| **Internationalization (i18n)** | [`i18n-localization-engineering`](../../.agents/skills/i18n-localization-engineering/SKILL.md) | User-facing text, 9-locale catalogs, language selection, locale formatting. | Semantic key enforcement, catalog parity, and RTL/formatting readiness. |
| **New Capability** | [`feature-implementation`](../../.agents/skills/feature-implementation/SKILL.md) | Designing and building new tools, panels, effects, or IPC commands. | Safe feature development without architectural regression. |
| **Defect / Fix** | [`bugfix-regression`](../../.agents/skills/bugfix-regression/SKILL.md) | Diagnosing crashes, audio/video drift, playhead glitches, or test failures. | Root-cause diagnosis and mandatory regression test authoring. |
| **Code Review** | [`code-review`](../../.agents/skills/code-review/SKILL.md) | Evaluating pull requests, git diffs, or agent-generated changes. | Correctness, concurrency, and boundary inspection. |
| **Media & Audio** | [`clypra-media-regression-testing`](../../.agents/skills/clypra-media-regression-testing/SKILL.md) | Timeline mathematics, audio synchronization, EvaluatedScene generation. | Specialized media and timeline automated test development. |
| **Pre-Release Audit** | [`release-readiness`](../../.agents/skills/release-readiness/SKILL.md) | Auditing release candidates, sidecar binaries, and package integrity. | Pre-release verification, smoke tests, and installer checks. |
| **Master Reference** | [`clypra-dev`](../../.agents/skills/clypra-dev/SKILL.md) | Deep-dive system documentation, store ownership, and performance signatures. | System onboarding and subsystem architecture reference. |

### 3.1 Principle of Smallest Relevant Combination
Where multiple skills apply, use the smallest relevant combination:
- **Localized UI change** (e.g. button styling, label change): Do NOT load comprehensive NLE or architecture workflows. Use localized edits and run standard typecheck.
- **Timeline bug fix** (e.g. split calculation): Activate `bugfix-regression` and consult `nle-domain-engineering`.
- **Core subsystem redesign** (e.g. playback engine or audio clock rewrite): Combine `architecture-design-review`, `nle-domain-engineering`, `senior-engineer-decision-making`, and `performance-reliability-engineering`, recording decisions in [`docs/architecture/adr/`](../architecture/adr/README.md).

---

## 4. Standard Agent Workflow Loop

Every agent must follow this lifecycle for any non-trivial change:

### Step 1: Pre-Execution Discovery & Plan
1. Read `AGENTS.md` and activate the appropriate skill.
2. Inspect the relevant subsystem files and surrounding call paths.
3. Formulate a small, focused implementation plan.

### Step 2: Implementation & Regression Guard
1. Implement the minimal coherent change.
2. Never introduce speculative abstractions or unrelated refactorings.
3. If fixing a bug:
   - Identify root cause vs symptom.
   - For preview/clock bugs: append a `describe("Bug N — Title")` block to `ProgramPreview.renderLoop.test.ts`.
   - For engine/store bugs: add tests in the corresponding subsystem test file.

### Step 3: Local Verification Gate
Execute the mandatory verification commands:
```bash
# 1. Verify docs links
npm run docs:check

# 2. Strict typecheck (must pass with 0 errors)
npx tsc --noEmit

# 3. Preview render loop regression suite
npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts

# 4. Relevant subsystem tests
npx vitest run <path/to/test.ts>

# 5. Rust tests (if native files modified)
cargo test --manifest-path src-tauri/Cargo.toml
```

### Step 4: Diff Inspection & Sign-off
1. Review `git diff` for accidental whitespace changes, leftover debug statements, or secrets.
2. Report results explicitly:
   - What was implemented or fixed.
   - Exactly which commands were run and their results.
   - Any environmental limitations preventing specific checks.
