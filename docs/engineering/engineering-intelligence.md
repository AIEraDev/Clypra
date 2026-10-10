# Clypra Engineering Intelligence & Feedback Systems

## 1. Overview & Objectives

Engineering Intelligence in Clypra is the operational discipline of turning **defects, performance anomalies, and agent execution metrics into permanent architectural defenses**.

The system connects:
- Production performance logs & diagnostic dumps (`perf_logs/`).
- Independent verification gates (`scripts/harness/`).
- Automated agent evaluations (`agent-evals/`).
- Architecture contracts & invariants (`docs/engineering/architecture-invariants.md`).

---

## 2. The 6-Stage Incident-to-Harness Feedback Loop

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Escaped Defect or Anomaly                       │
│        (Reported via NDJSON session log, user issue, or crash)         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 Stage 1: Forensic Root Cause Analysis                  │
│       (Investigate via `clypra-performance-log-analysis` / hunter)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Stage 2: Permanent Automated Regression Test             │
│        (Append describe block to ProgramPreview.renderLoop.test.ts)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              Stage 3: Mechanical Architecture Check Expansion          │
│         (Add AST / boundary check to check-architecture.mjs)           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Stage 4: Seeded Agent Evaluation Case Creation           │
│             (Add new JSON case under `agent-evals/cases/`)             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Stage 5: Multi-Agent Benchmark & Verification            │
│       (Test across Antigravity, Cursor, Kiro, Codex in worktrees)      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Stage 6: Updated Invariant Enforced                   │
│          (Future agent regressions mechanically blocked by CI)         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Engineering Telemetry Schema

For consequential engineering tasks, the harness records an append-only, privacy-conscious execution log in `test-results/engineering-telemetry.jsonl`:

```json
{
  "taskId": "task-uuid-or-issue-id",
  "category": "PREVIEW_PERFORMANCE",
  "agentPlatform": "Antigravity",
  "modelVersion": "claude-3-7-sonnet",
  "gitHeadAtStart": "abc1234",
  "filesChanged": [
    "src/components/editor/preview/NativeProgramPreview.tsx"
  ],
  "verificationOutcomes": {
    "verifyFast": "PASSED",
    "verifyArchitecture": "PASSED",
    "verifyUi": "PASSED",
    "durationSeconds": 24.5
  },
  "reviewDefectsFound": 0,
  "escapedRegressions": 0,
  "timestamp": "2026-10-10T08:15:00Z"
}
```

### Privacy & Security Guarantees
- Never log raw prompts, proprietary secrets, or personal user paths.
- Store only task categories, timing metrics, test pass/fail rates, and tool identifiers.
- Use metrics exclusively to identify recurring architectural friction points and calibrate agent skills.
