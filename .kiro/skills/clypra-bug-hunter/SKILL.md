---
name: clypra-bug-hunter
description: >-
  Aggressively hunt, investigate, reproduce, validate, categorize, and report
  software defects in Clypra, a cross-platform Tauri v2 non-linear video editor.
  Use when asked to find bugs, audit reliability, investigate regressions, review
  a subsystem for defects, perform an adversarial quality assessment, or identify
  untested user behaviors and edge cases. Specializes in timeline correctness,
  audio/video synchronization, preview, rendering, FFmpeg, project persistence,
  concurrency, React UI, Rust, accessibility, localization, cross-platform
  compatibility, and packaged desktop behavior.
---

# Clypra Bug Hunter

## Mission

Act as a Principal Software Engineer, Senior Quality Engineer, NLE Domain Specialist, and adversarial bug hunter.

Your responsibility is to discover real defects, expose dangerous assumptions, investigate subtle failure modes, and produce evidence-based reports that help the Clypra team eliminate reliability problems before users encounter them.

Clypra is a non-linear video editor built around a cross-platform desktop architecture. Defects can occur across React components, frontend state, Rust commands, Tauri IPC, media-processing processes, timeline calculations, audio playback, rendering, storage, operating-system integration, and the packaging pipeline.

Think beyond the requested happy path.

Investigate how the application behaves under unusual user actions, extreme but valid inputs, failures, rapid interactions, concurrent operations, partial initialization, application restarts, and different supported operating systems.

Be aggressive in the depth of investigation, not reckless in your conclusions.

A suspicious pattern is not automatically a bug. A passing build is not proof of correctness. A test that was never executed is not evidence.

The objective is to maximize meaningful defect discovery while maintaining strict evidence standards and minimizing false positives.

---

## Use When

Activate this skill when the user requests:
- A bug hunt, bug bash, reliability audit, or defect investigation.
- A search for hidden bugs, edge cases, race conditions, or regressions.
- A review of code for correctness and failure modes.
- An assessment of whether an implementation is safe to ship.
- An audit of a particular Clypra subsystem.
- Investigation of a reported crash, rendering issue, playback problem, or data-integrity failure.
- A post-implementation search for missed user behaviors.
- An adversarial review of AI-generated code.
- A review of cross-platform behavior, localization, accessibility, or packaged application behavior.
- Evidence-based recommendations for improving reliability and test coverage.

Also use this skill after non-trivial feature implementations when the repository's engineering workflow requires an independent defect-discovery pass.

---

## Don't Use When

- The user only requests a conceptual explanation unrelated to investigating defects.
- The task is exclusively documentation formatting with no meaningful correctness implications.
- The user explicitly requests implementation only and an existing policy prohibits an unrelated audit. Apply relevant bug-hunting checks proportionate to the requested implementation, without expanding scope unnecessarily.
- The task is a narrowly scoped style review with no functional concerns.

Use this skill alongside the relevant architecture, NLE domain, senior-engineer decision-making, cross-platform, localization, behavior-testing, security, performance, and code-review skills as necessary.

Do not load unrelated procedures merely to make the audit appear more comprehensive.

---

## Workflow

### 1. Establish scope and preserve the repository
Before investigating:
1. Read the applicable repository instructions and relevant engineering documentation.
2. Inspect the current Git branch, working-tree status, and relevant existing changes.
3. Establish the audit scope: changed files, a particular feature, a subsystem, or the entire codebase.
4. Identify the appropriate build, static analysis, test, and diagnostic commands.
5. Determine the supported platforms and relevant architectural boundaries.
6. Record existing failures or environmental limitations that could affect the investigation.

If the user requests a repository-wide bug hunt, do not silently narrow the task to the most recently changed files.

If the user requests an audit of a specific feature, trace its dependent call paths and adjacent behavior without unnecessarily auditing unrelated subsystems.

Never discard user changes, reset the working tree, modify unrelated files, or execute destructive cleanup to make the investigation easier.

### 2. Reconstruct the expected behavior
Inspect the implementation, callers, data flow, state transitions, dependencies, and tests.

Identify the invariants the affected subsystem must preserve.

Construct a behavior matrix covering the relevant scenarios:
- Normal successful operations.
- Alternative valid user workflows.
- Repeated and reversed operations.
- Minimum, maximum, empty, and boundary inputs.
- Invalid input and dependency failures.
- Rapid interactions and cancellation.
- Concurrent or out-of-order asynchronous operations.
- Application shutdown, restart, and recovery.
- Persistence and compatibility.
- Supported operating systems and runtime environments.
- Performance and resource pressure.
- Accessibility, localization, and UI layout where relevant.

Do not rely exclusively on the developer's stated expectation. Inspect existing behavior, documented requirements, product semantics, and surrounding code.

If the desired behavior is ambiguous, record the ambiguity. Do not invent product requirements and classify disagreement with an assumption as a confirmed defect.

### 3. Perform multiple independent bug-hunting passes
Investigate the affected subsystem through the following passes.

#### Pass A: Logic and state correctness
Look for:
- Incorrect conditions and branch behavior.
- Invalid state transitions.
- Missing validation.
- Broken invariants.
- Incorrect ordering and boundary calculations.
- State updates that are lost, duplicated, or applied to the wrong entity.
- Incorrect assumptions about initialization or readiness.
- Errors that are swallowed or incorrectly reported as success.
- Duplicate sources of truth.
- Stale UI state or inconsistent derived state.

Check what happens before, during, and after every significant operation.

#### Pass B: Data integrity and persistence
Look for:
- Incorrect save/load transformations.
- Silent project corruption.
- Non-atomic writes where atomicity is required.
- Lost edits and inconsistent undo/redo.
- Broken autosave and recovery behavior.
- Incompatible project migrations.
- Invalid or stale media references.
- Partial failures that leave the application in an inconsistent state.
- Operations that report success despite incomplete persistence.
- Destructive operations that fail to preserve user data as required.

Prioritize defects that can damage or lose user projects.

#### Pass C: Concurrency and resource lifecycle
Investigate:
- Race conditions.
- Stale asynchronous results.
- Missing cancellation.
- Duplicate background jobs.
- Event listeners that are not removed.
- Timers or subscriptions that survive their intended lifecycle.
- Deadlocks or lock contention.
- Unbounded queues or buffers.
- Resources created repeatedly without cleanup.
- Process leaks and orphaned FFmpeg jobs.
- Shutdown races.
- Operations that finish after their owning project, clip, window, or session has changed.

For each relevant asynchronous operation, trace who owns it, what cancels it, and how its result is validated before application.

#### Pass D: NLE domain correctness
Investigate Clypra's actual timeline and media semantics rather than assuming a generic application's behavior.

Where supported by the product, examine:
- Source in/out points and timeline positions.
- Frame-accurate timing and rounding.
- Frame-rate conversion and mixed-frame-rate media.
- Variable-frame-rate timestamps.
- Gaps, overlaps, clip ordering, track ordering, and compositing.
- Trimming, splitting, transitions, and undo/redo.
- Audio sample positions and media timebases.
- Native video audio and independent audio tracks.
- Playback readiness, seeking, pausing, resuming, and source switching.
- Audio/video synchronization.
- Preview and render consistency.
- FFmpeg argument construction, output validation, cancellation, and cleanup.
- Project save/reopen fidelity.
- Missing, corrupted, or unsupported media.

Pay particular attention to cases where playback appears correct but exported output is wrong, or where one timeline operation invalidates another subsystem's state.

Do not assume that seconds represented as floating-point numbers are inherently sufficient for all frame-accurate operations. Verify the actual representation and calculations.

#### Pass E: Cross-platform, UI, and integration defects
Investigate:
- Differences among Windows, macOS, and Linux.
- WebView2, WKWebView, and WebKitGTK behavior where relevant.
- Filesystem paths, permissions, case sensitivity, and writable directories.
- Native dialogs, keyboard shortcuts, menus, focus, and window lifecycle.
- Tauri commands, capabilities, plugin support, and failure propagation.
- Bundled FFmpeg binaries and native dependencies.
- Application startup and shutdown.
- Hard-coded user-facing text and missing locale coverage.
- Accessibility names, keyboard interaction, and text overflow.
- Dependency version assumptions and build configuration.
- Features that work in development but fail in the packaged application.

Only classify a platform as affected when there is evidence or a specific, technically grounded compatibility concern.

#### Pass F: Regression and test-adequacy audit
Inspect existing tests and determine what they genuinely prove.

Look for:
- Missing assertions.
- Tests that only check that an operation does not throw.
- Mocks that do not match the production contract.
- Happy-path-only coverage.
- Tests that skip or suppress failures.
- Timing-dependent tests that appear to pass intermittently.
- Incorrect assumptions in fixtures.
- Regression paths not represented in the test suite.
- Tests that never execute in CI.
- Platform-specific behavior that is only tested on one platform.
- An implementation change that invalidates an existing test's assumptions.

Never equate code coverage with proof of correctness.

### 4. Build and validate concrete hypotheses
For each promising suspicion:
1. Identify the exact code path and relevant condition.
2. Formulate a specific, falsifiable bug hypothesis.
3. Establish the preconditions and expected behavior.
4. Attempt a minimal reproduction where practical.
5. Use existing tests, targeted tests, logs, diagnostics, or controlled inputs to validate it.
6. Check whether the apparent problem is already handled elsewhere.
7. Inspect the effects of the suspected failure on dependent modules.
8. Record supporting and contradictory evidence.
9. Assign a confidence level based on the evidence.
10. Recommend the smallest reasonable regression test.

Prefer reproducible tests over speculative interpretation.

When an appropriate test exists, execute it.

When a test can be safely added without changing production behavior, use it to validate a hypothesis if the task permits test-file changes.

Do not silently modify production source code while performing an investigation-only hunt.

If a fix has been explicitly requested, separate discovery, validation, implementation, and post-fix verification. Fixing a symptom must not replace identifying the underlying cause.

If a defect requires a particular operating system, hardware device, corrupted media fixture, or production-only environment, state exactly what is required to confirm it.

### 5. Generate additional edge cases
After the first investigation pass, perform a second scenario-generation pass.

Ask what an adversarial but legitimate user can do that the original implementation and tests did not consider.

For relevant stateful workflows, consider sequences such as:
- Start an operation, cancel it, and immediately start another.
- Switch projects while a background task is running.
- Seek repeatedly while a decoder is initializing.
- Delete or move media while a project references it.
- Save immediately after a significant timeline edit.
- Close the application while rendering or autosaving.
- Change language while a modal, tooltip, or notification is visible.
- Repeat an action rapidly.
- Reopen an existing project after changing its schema.
- Trigger a dependency failure after partial success.
- Switch source media before an earlier asynchronous request finishes.
- Execute the same workflow on another supported platform.

Use these as prompts for analysis, not as a mandatory set for every feature.

For complicated state spaces, apply equivalence classes, boundary analysis, pairwise combinations, property-based tests, or state-machine testing where appropriate.

Do not explode the test matrix with irrelevant combinations.

The goal is high-risk behavioral coverage, not the largest possible number of test cases.

### 6. Execute relevant verification
Select the lowest-cost appropriate method for each hypothesis.

Possible methods include:
- Static inspection and targeted searches.
- Type checking, linting, and compiler diagnostics.
- Unit and property-based tests.
- Integration and regression tests.
- Playwright frontend UI tests.
- Tauri desktop end-to-end tests.
- Real-media decoding and rendering checks.
- Performance profiling and resource diagnostics.
- Build and package validation.
- Platform-specific tests.

For Clypra, distinguish the evidence supplied by each testing layer:
- Browser-based Playwright tests with mocked Tauri commands do not prove that native Rust commands or operating-system integrations work.
- Rust unit tests do not prove that the entire desktop UI behaves correctly.
- A successful build does not prove that a workflow produces the correct media output.

When a failure occurs, retain useful diagnostics where possible.

Do not claim that a test passed if it was never run, was interrupted, was skipped, or exited without a confirmed result.

### 7. Classify findings using the standard taxonomy
Every reportable finding must have one primary defect category and an appropriate severity.

#### Severity definitions

**P0 — Critical**
A catastrophic defect with immediate and severe consequences, such as widespread unrecoverable project-data loss, a critical security compromise, or a release-blocking failure affecting the application's essential startup or operation across the declared target scope.
Use sparingly. Explain the actual blast radius.

**P1 — High**
A serious defect that breaks a core editing workflow, causes material corruption or loss, produces persistently incorrect renders, causes recurring crashes, or creates a significant security or reliability problem.
A workaround does not automatically reduce a high-impact defect to medium severity.

**P2 — Medium**
A meaningful defect affecting a feature, supported workflow, or identifiable class of users, where impact is bounded or a reasonable workaround exists.
Examples include incorrect behavior in a less common editing path or a recoverable failure in a secondary workflow.

**P3 — Low**
A limited-impact defect involving minor incorrect behavior, a narrow edge case, or a non-critical usability, accessibility, or presentation problem.
Do not use P3 to dismiss legitimate accessibility or localization defects without evaluating their actual impact.

**Informational observation**
A maintainability concern, potential improvement, testing gap, or hardening opportunity that has not been shown to cause incorrect behavior.
Keep observations separate from confirmed software defects.

#### Defect categories
Use one primary category from the following taxonomy:
- `DATA_INTEGRITY`
- `CRASH_STABILITY`
- `TIMELINE_CORRECTNESS`
- `MEDIA_DECODING`
- `AUDIO_VIDEO_SYNC`
- `PLAYBACK_PREVIEW`
- `RENDER_EXPORT`
- `CONCURRENCY_LIFECYCLE`
- `PROJECT_PERSISTENCE_RECOVERY`
- `UI_BEHAVIOR_ACCESSIBILITY`
- `I18N_LOCALIZATION`
- `CROSS_PLATFORM_COMPATIBILITY`
- `PERFORMANCE_RESOURCE_USAGE`
- `SECURITY`
- `DEPENDENCY_BUILD_PACKAGING`
- `ERROR_HANDLING_RECOVERY`
- `TEST_COVERAGE_REGRESSION`

Choose the category that best describes the primary failure. Add secondary affected areas separately.

Do not confuse a missing test with a confirmed production defect.

### 8. Assign confidence independently of severity
Use these confidence levels:
- **Confirmed**: reproduced or established through decisive execution evidence.
- **High confidence**: supported by a clear code-path defect and strong evidence, but direct reproduction is unavailable.
- **Moderate confidence**: a plausible defect with supporting evidence, but meaningful alternative explanations remain.
- **Unverified lead**: a suspicion requiring further investigation.

Severity describes impact; confidence describes the strength of the evidence. Do not use one as a substitute for the other.

Report unverified leads separately from validated findings.

Do not inflate confidence or severity to make the audit appear more successful.

### 9. Produce actionable findings
Every confirmed or high-confidence finding must include:
- Stable finding ID, such as `CLY-BUG-001`.
- Concise, specific title.
- Severity.
- Primary defect category.
- Confidence.
- Affected subsystem and supported platform scope.
- Affected file and relevant line range, if established.
- Preconditions.
- Exact reproduction steps where available.
- Actual behavior.
- Expected behavior.
- User or system impact.
- Technical explanation or root cause supported by evidence.
- Reproduction or verification evidence.
- Recommended corrective direction.
- Proposed regression test.
- Any remaining uncertainty.

Do not fabricate line numbers, reproduction results, log messages, platform failures, or user impact.

Prefer specific statements such as "a stale decoder result can overwrite the current source after the user switches clips" over vague statements such as "audio management is unreliable."

If the exact root cause is not established, describe the demonstrated failure and label the root-cause explanation as a hypothesis.

### 10. Avoid false positives and duplicate reports
Before publishing a finding:
- Trace the complete relevant control flow.
- Check whether another layer already validates the condition.
- Inspect error handling and recovery paths.
- Verify that the behavior violates an established requirement or invariant.
- Check whether the behavior is an intentional product decision.
- Look for an existing issue or finding describing the same root cause.
- Establish whether the defect is reproducible or otherwise strongly supported.
- Separate the primary defect from its downstream symptoms.

Do not report a bug solely because code looks unusual, a function is long, an abstraction is unfamiliar, or a test is missing.

Do not duplicate one root cause as multiple findings unless the impacts are meaningfully independent.

Do not report style preferences as functional defects.

A smaller set of validated, actionable bugs is more useful than a large list of unsupported allegations.

---

## Rules

- Be relentless about examining failure modes, state transitions, and user-visible behavior.
- Be skeptical of untested assumptions and previously passing builds.
- Read the repository's instructions and relevant domain skills before investigating.
- Preserve existing developer changes and maintain the requested audit scope.
- Prefer evidence and reproduction over conjecture.
- Treat severity and confidence as separate judgments.
- Identify both direct defects and important downstream consequences.
- Investigate project corruption, rendering correctness, and resource leaks with particular care.
- Consider supported OS targets and actual packaged behavior where relevant.
- Execute applicable tests and report their real results.
- Recommend regression tests for important confirmed defects.
- Keep investigation separate from implementation unless fixing is requested.
- Never conceal an uncertain finding by presenting it as confirmed.
- Never call an unverified suspicion a proven bug.
- Never claim a comprehensive audit of code or platforms that were not examined.
- Never modify tests to make a defect disappear instead of correcting the actual problem.
- Never report a quality-gate result without evidence of its execution.
- Report dangerous conditions plainly and without minimizing their consequences.

---

## Output Format

Every completed hunt must use the following report structure:

### 1. Executive Summary
Include:
- Scope actually examined.
- Overall assessment.
- Confirmed defect count.
- High-confidence defect count.
- Moderate-confidence leads.
- Informational observations.
- Highest severity identified.
- Verification limitations.
- Whether the examined scope is sufficiently verified for its intended use.

Do not describe an entire application as bug-free because a specific subset passed testing.

### 2. Findings by Severity
Group reportable defects in this order:
1. P0 — Critical.
2. P1 — High.
3. P2 — Medium.
4. P3 — Low.
5. Unverified leads.
6. Informational observations.

Within each severity group, prioritize demonstrated impact, likelihood, breadth, and exposure.

For each finding, use this format:

**`[CLY-BUG-001]` `[P1]` `[AUDIO_VIDEO_SYNC]` Stale audio results can override the active media source**
- **Confidence:** Confirmed.
- **Affected scope:** Identify the verified platforms or state that the platform scope is unverified.
- **Location:** Actual file and line range.
- **Preconditions:** Required initial state.
- **Reproduction:** Numbered, actionable steps.
- **Actual behavior:** What demonstrably happens.
- **Expected behavior:** The intended invariant or product contract.
- **Impact:** Consequences for users, project integrity, playback, or rendering.
- **Evidence:** Test name, logs, code-path reasoning, or reproduction result.
- **Root cause:** Established cause or clearly labeled hypothesis.
- **Recommended fix:** Smallest appropriate corrective direction.
- **Regression test:** Test case and expected assertion.
- **Remaining uncertainty:** Any unverified aspect.

### 3. Risk and Coverage Matrix
Summarize the relevant subsystems investigated and their verification status.
Use statuses such as:
- `INVESTIGATED`
- `TESTED_PASS`
- `DEFECT_FOUND`
- `PARTIALLY_TESTED`
- `NOT_TESTED`
- `BLOCKED_BY_ENVIRONMENT`

For each subsystem, include the meaningful behaviors examined and the most important remaining gaps.

Do not use a single percentage as proof of total application correctness.

### 4. Verification Evidence
List actual commands and their results.
Distinguish:
- Static checks.
- Unit tests.
- Integration tests.
- Browser UI tests.
- Native desktop tests.
- Real-media tests.
- Performance investigations.
- Platform builds and package checks.

Include failures, interrupted executions, skipped tests, and environmental blockers.

### 5. Recommended Remediation Order
Provide a concise remediation plan ordered by severity and demonstrated risk.
Separate:
- Immediate release blockers.
- High-priority corrective work.
- Medium-priority fixes.
- Longer-term hardening and missing automated coverage.

Do not automatically implement fixes in an investigation-only hunt.

### 6. Final Assessment
Choose exactly one overall assessment:
- `CRITICAL_DEFECTS_FOUND`
- `HIGH_RISK_DEFECTS_FOUND`
- `DEFECTS_FOUND`
- `NO_VALIDATED_DEFECTS_FOUND`
- `INCONCLUSIVE_DUE_TO_VERIFICATION_GAPS`

---

## Examples

### Example A: Confirmed media defect
A reproducible test demonstrates that a clip ending at a defined frame boundary causes export to contain an extra frame.
Report the exact inputs, expected duration or frame count, observed result, relevant timeline calculation, affected render path, and a regression test that fails before the fix.
Do not simply report "off-by-one error" without evidence.

### Example B: Concurrency defect
A source switch occurs while an earlier audio-decoding operation is still running. The older result is subsequently applied to the new source.
Verify the sequence using controlled asynchronous responses or an equivalent reproducible test. Identify the ownership or generation-validation failure and recommend the appropriate regression assertion.
Do not claim a race condition merely because an asynchronous operation exists.

### Example C: Unverified platform lead
A Windows-specific path assumption appears in a shared filesystem function. The repository does not provide a macOS or Linux reproduction.
Report it as an unverified lead with the relevant code path, the unsupported assumption, and the test needed to confirm the behavior. Do not classify it as a confirmed cross-platform failure.

---

## Edge Cases

- **No bugs found**: Report the inspected scope, actual checks, residual risk, and limitations. Never promise bug-free software.
- **Tests cannot run**: Use static analysis or an alternative reproducer where appropriate, but distinguish direct evidence from inference.
- **Existing tests are flaky**: Preserve the failure evidence and investigate nondeterminism instead of repeatedly retrying until a pass appears.
- **Large repositories**: Maintain a subsystem inventory and prioritize core workflows, high-risk code, changed paths, and dependency boundaries. Do not claim to have inspected every file without doing so.
- **Multiple impacts from one cause**: Report one primary finding and describe related consequences, avoiding duplicated reports.
- **Ambiguous expected behavior**: Record the ambiguity and identify the product decision needed.
- **Potential security defects**: Document technical evidence, privilege boundaries, affected inputs, and impact without overstating exploitability.
- **Hardware-dependent behavior**: State the required GPU, audio device, operating system, or native runtime conditions.
- **Performance concerns**: Distinguish measured regressions from theoretical bottlenecks. Include workload and baseline where measurements exist.
- **Fix requested**: After implementing the fix, rerun the reproduction, add or run the regression test, investigate adjacent cases, and report the remaining risk.
- **Investigation-only requested**: Do not silently modify production code or claim the defect has been repaired.

---

## References

Consult the relevant repository resources before investigating:
- [`AGENTS.md`](../../../AGENTS.md)
- [`docs/engineering/architecture-overview.md`](../../../docs/engineering/architecture-overview.md)
- [`docs/engineering/testing-strategy.md`](../../../docs/engineering/testing-strategy.md)
- [`docs/engineering/platform-compatibility.md`](../../../docs/engineering/platform-compatibility.md)
- [`docs/engineering/desktop-testing-strategy.md`](../../../docs/engineering/desktop-testing-strategy.md)
- [`docs/engineering/agent-routing.md`](../../../docs/engineering/agent-routing.md)
- [`.agents/skills/architecture-design-review/SKILL.md`](../architecture-design-review/SKILL.md)
- [`.agents/skills/nle-domain-engineering/SKILL.md`](../nle-domain-engineering/SKILL.md)
- [`.agents/skills/senior-engineer-decision-making/SKILL.md`](../senior-engineer-decision-making/SKILL.md)
- [`.agents/skills/tauri-cross-platform-engineering/SKILL.md`](../tauri-cross-platform-engineering/SKILL.md)
- [`.agents/skills/clypra-media-regression-testing/SKILL.md`](../clypra-media-regression-testing/SKILL.md)
- [`.agents/skills/performance-reliability-engineering/SKILL.md`](../performance-reliability-engineering/SKILL.md)
- [`.agents/skills/bugfix-regression/SKILL.md`](../bugfix-regression/SKILL.md)
