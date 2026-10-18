# Clypra Automatic AI Engineering Orchestration & Agent Routing Specification

## 1. Mission & Architectural Intent

Clypra relies on multiple AI coding agents across engineering sessions, including **Antigravity**, **Cursor**, **Kiro**, and **OpenAI Codex**.
To ensure uniform engineering rigor, code quality, and invariant preservation, agents must **automatically** activate the correct specialized skills, guidelines, and verification pipelines without requiring developers to manually invoke skills or repeat repository standards.

---

## 2. Multi-Agent Entrypoint Architecture

Each supported agent platform connects to Clypra's unified standards through its native configuration hook:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   Developer Request                                     │
└────────────────────────────────────────────┬────────────────────────────────────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
       ┌───────────────────────────────┐           ┌───────────────────────────────┐
       │   Antigravity & Codex         │           │   Cursor & Kiro               │
       │   `AGENTS.md` (Universal)     │           │   `.cursor/rules/clypra.mdc`   │
       │   Builtin & Custom Skills     │           │   `.kiro/steering/`           │
       └───────────────┬───────────────┘           └───────────────┬───────────────┘
                       │                                           │
                       └─────────────────────┬─────────────────────┘
                                             │
                                             ▼
                      ┌─────────────────────────────────────────────┐
                      │    Automatic Intent Classification Engine   │
                      │    (Keyword, Domain, & Risk Analysis)       │
                      └──────────────────────┬──────────────────────┘
                                             │
      ┌──────────────────────────────────────┼──────────────────────────────────────┐
      ▼                                      ▼                                      ▼
┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
│ Bugfix & Regression       │  │ i18n & Localization       │  │ NLE Domain Math           │
│ `bugfix-regression`       │  │ `i18n-localization-...`   │  │ `nle-domain-engineering`  │
└───────────────────────────┘  └───────────────────────────┘  └───────────────────────────┘
```

1. **Antigravity**: Automatically loads `AGENTS.md` as user rules on every turn. Discovers skills under `.agents/skills/`.
2. **OpenAI Codex**: Automatically loads `AGENTS.md` from the repository root.
3. **Cursor**: Automatically loads `.cursor/rules/clypra.mdc` with `alwaysApply: true`. Points to `AGENTS.md` and `.agents/skills/`.
4. **Kiro**: Automatically loads steering documents from `.kiro/steering/clypra-agents.md`.

---

## 3. Automatic Task Classification & Skill Routing Matrix

When an agent receives any new request, it must automatically evaluate the task against this classification matrix:

| Task Characteristics & Keywords | Primary Specialized Skill | Secondary / Supporting Skills |
| :--- | :--- | :--- |
| **Bug hunt, bug bash, reliability audit, defect discovery, adversarial review, find bugs** | `clypra-bug-hunter` | `bugfix-regression`, `behavior-coverage` |
| **Crash, freeze, bug, regression, unexpected error, broken, drift, mismatch** | `bugfix-regression` | `behavior-coverage`, `clypra-media-regression-testing` |
| **Translation, language, locale, i18n, l10n, Russian, Spanish, Japanese, German, French, Korean, Chinese, catalog, formatting** | `i18n-localization-engineering` | `behavior-coverage` |
| **UI design, usability review, layout, component, accessibility, interaction, WCAG, design tokens, focus navigation** | `clypra-ui-ux-engineering` | `i18n-localization-engineering`, `behavior-coverage`, `tauri-cross-platform-engineering` |
| **New tool, new button, new panel, new effect, filter, export option, new UI feature, subsystem upgrade** | `feature-implementation` | `behavior-coverage`, `performance-reliability-engineering`, `senior-engineer-decision-making` |
| **Timeline math, SMPTE, timecode, framerate, fps, split, ripple, gap engine, AV sync** | `nle-domain-engineering` | `clypra-media-regression-testing`, `behavior-coverage` |
| **Native preview, canvas/bridge, wgpu, Metal, DirectX, frame pacing, dropped frames, preview benchmark, readback cost** | `clypra-preview-performance-engineering` | `performance-reliability-engineering`, `nle-domain-engineering`, `tauri-cross-platform-engineering` |
| **Perf logs, session logs, ndjson, telemetry analysis, remote session, frame timing trace, performance incident, latency spike** | `clypra-performance-log-analysis` | `clypra-preview-performance-engineering`, `clypra-bug-hunter`, `performance-reliability-engineering` |
| **Specific file/function/subsystem review, improve logic, optimize a code path, compare approaches, validate current engineering patterns or research before implementation** | `clypra-codebase-optimization-research` | `architecture-design-review`, `performance-reliability-engineering`, `senior-engineer-decision-making` |
| **Lag, stutter, frame drop, high memory usage, IPC bottleneck, cache exhaustion, leaks** | `performance-reliability-engineering` | `clypra-dev` |
| **Windows paths, macOS menus, Linux WebKitGTK, Tauri commands, IPC invoke, OS dialogs** | `tauri-cross-platform-engineering` | `architecture-design-review` |
| **Tauri native API, OS window, HWND, NSWindow, GTK, GtkWindow, SetWindowPos, addChildWindow, run_on_main_thread, native UI thread safety, thread affinity, platform event loop, SIGTRAP, EXC_BREAKPOINT** | `tauri-native-thread-safety` | `tauri-cross-platform-engineering`, `bugfix-regression` |
| **EvaluatedScene, thumbnail cache, filmstrip, decode pipeline, GPU compositor** | `clypra-media-regression-testing` | `nle-domain-engineering` |
| **Subsystem boundary, store reorganization, persistence schema change, refactor** | `architecture-design-review` | `senior-engineer-decision-making` |
| **Version bump, packaged installer (.dmg, .msi, .deb), sidecar binary, release audit** | `release-readiness` | `tauri-cross-platform-engineering` |

### 3.1 Dedicated Internationalization Skill Registration

| Field             | Required value                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Skill             | `i18n-localization-engineering`                                                                  |
| Path              | `.agents/skills/i18n-localization-engineering/SKILL.md`                                          |
| Activation        | User-facing text, language changes, locale formatting, translation catalogs, localization review |
| Required evidence | Catalog validation and appropriate component, Playwright, or native tests                        |

### 3.2 Dedicated Bug Hunter Skill Registration

| Field             | Required value                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Skill             | `clypra-bug-hunter`                                                                              |
| Path              | `.agents/skills/clypra-bug-hunter/SKILL.md`                                                      |
| Activation        | Bug hunting, defect audits, adversarial review, reliability investigations, regression search     |
| Required evidence | Evidence-based findings with severity, confidence, reproduction, and proposed regression tests    |

### 3.3 Dedicated Preview Performance Engineering Skill Registration

| Field             | Value                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Skill             | `clypra-preview-performance-engineering`                                                                                 |
| Path              | `.agents/skills/clypra-preview-performance-engineering/SKILL.md`                                                         |
| Activation        | Native preview, canvas/bridge rendering, frame pacing, rendering performance, GPU transfer, and preview regressions      |
| Related skills    | `performance-reliability-engineering`, `nle-domain-engineering`, `tauri-cross-platform-engineering`, `clypra-bug-hunter` |
| Required evidence | Verified active path, matched workloads, recorded measurements, correctness results, and a findings report               |

### 3.4 Dedicated Performance Log Analysis Skill Registration

| Field           | Value                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Skill           | `clypra-performance-log-analysis`                                                                                                   |
| Path            | `.agents/skills/clypra-performance-log-analysis/SKILL.md`                                                                           |
| Activates for   | Local/remote diagnostics, performance logs, profiler traces, session comparisons and regression investigations                      |
| Related skills  | `clypra-preview-performance-engineering`, `clypra-bug-hunter`, `performance-reliability-engineering`, `nle-domain-engineering`      |
| Required output | Session inventory, reconstructed timeline, findings with confidence, cross-session comparability assessment and recommended actions |

### 3.5 Dedicated UI/UX Engineering Skill Registration

| Field | Value |
| :--- | :--- |
| Skill | `clypra-ui-ux-engineering` |
| Path | `.agents/skills/clypra-ui-ux-engineering/SKILL.md` |
| Activates for | UI implementation, usability reviews, design consistency, accessibility, desktop layout and interaction changes |
| Related skills | `i18n-localization-engineering`, `clypra-bug-hunter`, `tauri-cross-platform-engineering`, behavior testing and Playwright |
| Required evidence | Relevant workflow verification, visual inspection where available, accessibility checks and actual test results |

### 3.6 Dedicated Native Thread Safety Skill Registration

| Field | Value |
| :--- | :--- |
| Skill | `tauri-native-thread-safety` |
| Path | `.agents/skills/tauri-native-thread-safety/SKILL.md` |
| Activates for | Native OS window operations, AppKit NSWindow, Win32 HWND, Linux GTK, graphics surfaces, run_on_main_thread, thread affinity |
| Related skills | `tauri-cross-platform-engineering`, `bugfix-regression`, `performance-reliability-engineering` |
| Required evidence | Thread-affinity audit, dispatch boundary verification, atomic lifecycle state transitions, unit tests, and platform checks |

### 3.7 Dedicated Scoped Codebase Optimization & Research Skill

| Field | Value |
| :--- | :--- |
| Skill | clypra-codebase-optimization-research |
| Path | .agents/skills/clypra-codebase-optimization-research/SKILL.md |
| Activates for | Targeted file/function/subsystem investigations, improvement recommendations, architecture and logic optimization, technical-debt assessments, and current-approach validation before implementation |
| Related skills | architecture-design-review, performance-reliability-engineering, senior-engineer-decision-making; add domain-specific skills when relevant |
| Required output | Evidence-linked findings, explicit fact/inference/hypothesis labels, impact and confidence, trade-off-aware recommendations, current sources when research is warranted, and a targeted verification plan |

This skill is investigation-first and read-only by default. Do not implement changes unless the developer explicitly asks for implementation. Current research must be checked against Clypra's actual versions and architecture; performance claims require relevant measurements.

### 3.8 Mandatory Mixed-Stack Benchmark & Deep Automation Contract

For every new feature, layer type, or subsystem upgrade, the agent must automatically execute the Deep Automation Contract:
1. **Multi-Property Mixed-Stack Testing**: Evaluate against realistic composite timelines combining Video + Audio/Music + Text + Stickers + Transforms (`goldenProjectManifest.ts`). Never benchmark features in isolation.
2. **High-Concurrency Scalability Stress**: Benchmark 1, 10, 50, and 100+ concurrent instances, measuring latency distributions (p50, p95, max) and memory deltas over sustained loops.
3. **Cross-Subsystem Interference & Root-Cause Explanation**: Verify zero audio thread starvation (CPAL/rtrb), zero playhead drift from `PlaybackClock.ts`, zero unintended native surface fallbacks, and identify the physical root cause of any performance bottlenecks.
4. **Production Telemetry Hooks**: Register per-frame timings, cache statistics, and fallback triggers with `telemetryCollector` and NDJSON logs.
5. **Deep Mathematical Oracles**: Implement golden-frame pixel diffs ($\text{PSNR} \ge 60\text{ dB}$, $\text{MSE} \le 0.0001$), audio RMS signal tests, and command undo/redo fuzzers to make manual testing optional.

---

## 4. Mandatory 4-Phase Agent Execution Protocol

Every coding agent must execute these 4 phases sequentially on every non-trivial task:

### Phase 1: Silent Intake & Context Loading
1. Classify the user prompt against the Skill Routing Matrix.
2. Read the designated `SKILL.md` file(s) before proposing or implementing changes.
3. Inspect existing files, call trees, and store structures to understand the baseline before modifying code.

### Phase 2: Invariant Check & Minimal Coherent Plan
1. Check the 11 non-negotiable architectural invariants in `AGENTS.md`.
2. Propose the minimal coherent change set. Reject unneeded abstractions or speculative rewrites.

### Phase 3: Implementation & Dual-Pass Behavior Coverage
1. Make targeted edits preserving documentation and non-breaking backward compatibility.
2. Formulate test scenarios across applicable categories (A through J).
3. Implement automated tests at the lowest-cost appropriate layer (Unit, Subsystem, Playwright UI, Native Desktop).

### Phase 4: Automated Verification & Report
Execute the required verification commands:
- Documentation integrity: `npm run docs:check`
- Internationalization catalog parity: `npm run i18n:check`
- TypeScript static analysis: `npx tsc --noEmit` (0 errors required)
- Vitest unit/integration suites: `npx vitest run <test_file>`
- Append-only preview render loop: `npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts`
- Playwright E2E suites: `npx playwright test`
- Rust backend tests: `cargo test --manifest-path src-tauri/Cargo.toml`
- Production build: `npm run build`
