import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateSession } from "./evaluate-acceptance.mjs";

test("evaluateSession passes valid closed session with all criteria", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-test-"));
  try {
    const filePath = path.join(directory, "session-test.ndjson");
    const records = [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: "test-session-1",
          scenarioHash: "abc123hash",
          mediaHash: "media123hash",
          projectHash: "project123hash",
          projectComputedDuration: 60,
          projectFrameRate: 25,
          mediaFrameRate: 25,
          experimentArmMeaning: "dirty-recovery-enabled",
          resolvedFlags: { CLYPRA_DEBUG_DISABLE_DIRTY_RECOVERY: false },
          build: { perfDriverEnabled: true },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1100,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1500,
        payload: { marker: "native-playback-startup", stage: "first-native-frame-presented", elapsedUs: 400000 },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3100,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3101,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 3101,
        payload: {
          workloadSnapshots: {
            playback: { completedFrames: 20, droppedFrames: 1 },
          },
        },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 3101,
        payload: {
          previewConcurrency: { dirtyRecoveries: 0 },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 15000,
        payload: { marker: "sched.decision", phaseId: "steady_playback", lookaheadFrames: 4, action: "keep" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 25000,
        payload: { marker: "sched.decision", phaseId: "steady_playback", lookaheadFrames: 3, action: "start" },
      },
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 33100,
        payload: {
          workloadSnapshots: {
            playback: { completedFrames: 770, droppedFrames: 2 },
          },
        },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 33100,
        payload: {
          totalFramesPresented: 770,
          totalFramesDropped: 2,
          previewConcurrency: { dirtyRecoveries: 0 },
          transfers: { zero_copy_guard_violations: 0 },
        },
      },
      {
        kind: "composition-rollup",
        timestampEpochMs: 33100,
        payload: {
          compositionMetrics: {
            maxVisualLayers: 1,
            maxMediaLayers: 1,
            maxAudioClips: 1,
            visualLayerPercentiles: { p50: 1, p95: 1, p99: 1 },
            videoLayerPercentiles: { p50: 1, p95: 1, p99: 1 },
            textLayerPercentiles: { p50: 0, p95: 0, p99: 0 },
            imageLayerPercentiles: { p50: 0, p95: 0, p99: 0 },
            audioClipPercentiles: { p50: 1, p95: 1, p99: 1 },
          },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 33101,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "session-footer",
        timestampEpochMs: 33200,
        payload: { status: "closed" },
      },
    ];

    await writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const result = await evaluateSession(filePath);
    assert.equal(result.allPassed, true);
    assert.equal(result.criteria.c1_debugEndpointProtected.pass, true);
    assert.equal(result.criteria.c4_startupPhaseIsolated.pass, true);
    assert.equal(result.criteria.c5_steadyPlaybackPresented.pass, true);
    assert.equal(result.criteria.c8_footerClosed.pass, true);
    assert.equal(result.criteria.c9_compositionRollup.pass, true);
    assert.equal(result.criteria.c13_timeToFirstFrame.pass, true);
    assert.equal(result.criteria.c14_lookaheadDepthSteady.pass, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluateSession verifies multi-layer criteria for composite presets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-composite-"));
  try {
    const filePath = path.join(directory, "session-composite.ndjson");
    const records = [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: "test-composite-1",
          scenarioHash: "composite123",
          scenarioPreset: "playback-composite-30s",
          mediaHash: "media123hash",
          projectHash: "project123hash",
          projectComputedDuration: 60,
          projectFrameRate: 25,
          mediaFrameRate: 25,
          experimentArmMeaning: "dirty-recovery-enabled",
          resolvedFlags: { CLYPRA_DEBUG_DISABLE_DIRTY_RECOVERY: false },
          build: { perfDriverEnabled: true },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1100,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1600,
        payload: { marker: "native-playback-startup", stage: "first-native-frame-presented", elapsedUs: 500000 },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3100,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3101,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "composite_playback", phaseKind: "play" },
      },
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 3101,
        payload: { workloadSnapshots: { playback: { completedFrames: 0, droppedFrames: 0 } } },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 3101,
        payload: { previewConcurrency: { dirtyRecoveries: 0 } },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 15000,
        payload: { marker: "sched.decision", phaseId: "composite_playback", lookaheadFrames: 5, action: "keep" },
      },
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 33100,
        payload: { workloadSnapshots: { playback: { completedFrames: 745, droppedFrames: 3 } } },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 33100,
        payload: {
          totalFramesPresented: 745,
          totalFramesDropped: 3,
          previewConcurrency: { dirtyRecoveries: 0 },
          transfers: { zero_copy_guard_violations: 0 },
        },
      },
      {
        kind: "composition-rollup",
        timestampEpochMs: 33100,
        payload: {
          compositionMetrics: {
            maxVisualLayers: 4,
            maxMediaLayers: 2,
            maxAudioClips: 2,
            visualLayerPercentiles: { p50: 3, p95: 4, p99: 4 },
            videoLayerPercentiles: { p50: 2, p95: 2, p99: 2 },
            textLayerPercentiles: { p50: 1, p95: 2, p99: 2 },
            imageLayerPercentiles: { p50: 1, p95: 1, p99: 1 },
            audioClipPercentiles: { p50: 2, p95: 2, p99: 2 },
          },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 33101,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "composite_playback", phaseKind: "play" },
      },
      {
        kind: "session-footer",
        timestampEpochMs: 33200,
        payload: { status: "closed" },
      },
    ];

    await writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const result = await evaluateSession(filePath);
    assert.equal(result.allPassed, true);
    assert.equal(result.criteria.c9_compositionRollup.pass, true);
    assert.equal(result.criteria.c5_steadyPlaybackPresented.pass, true);
    assert.equal(result.criteria.c14_lookaheadDepthSteady.pass, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluateSession flags harness play retry masking when playStartAttempts > 1", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-retry-"));
  try {
    const filePath = path.join(directory, "session-retry.ndjson");
    const records = [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: "test-retry-1",
          scenarioHash: "hash-retry",
          mediaHash: "media123",
          projectHash: "project123",
          projectComputedDuration: 60,
          projectFrameRate: 25,
          mediaFrameRate: 25,
          experimentArmMeaning: "dirty-recovery-enabled",
          resolvedFlags: { CLYPRA_DEBUG_DISABLE_DIRTY_RECOVERY: false },
          build: { perfDriverEnabled: true },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1100,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1500,
        payload: { marker: "native-playback-startup", stage: "first-native-frame-presented", elapsedUs: 400000 },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3100,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3101,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "steady_playback", phaseKind: "play", playStartAttempts: 2 },
      },
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 33100,
        payload: { workloadSnapshots: { playback: { completedFrames: 750, droppedFrames: 0 } } },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 33100,
        payload: {
          totalFramesPresented: 750,
          totalFramesDropped: 0,
          previewConcurrency: { dirtyRecoveries: 0 },
          transfers: { zero_copy_guard_violations: 0 },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 20000,
        payload: { marker: "sched.decision", phaseId: "steady_playback", lookaheadFrames: 4, action: "keep" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 33101,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "session-footer",
        timestampEpochMs: 33200,
        payload: { status: "closed" },
      },
    ];

    await writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const result = await evaluateSession(filePath);
    assert.equal(result.criteria.c10_playStartAttempts.pass, false);
    assert.equal(result.allPassed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluateSession fails on freeze > 200ms or 0 expected frames", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-freeze-"));
  try {
    const filePath = path.join(directory, "session-freeze.ndjson");
    const records = [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: "test-freeze-1",
          scenarioHash: "hash-freeze",
          mediaHash: "media123",
          projectHash: "project123",
          projectComputedDuration: 60,
          projectFrameRate: 25,
          mediaFrameRate: 25,
          experimentArmMeaning: "dirty-recovery-enabled",
          resolvedFlags: { CLYPRA_DEBUG_DISABLE_DIRTY_RECOVERY: false },
          build: { perfDriverEnabled: true },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1100,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1500,
        payload: { marker: "native-playback-startup", stage: "first-native-frame-presented", elapsedUs: 400000 },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3100,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3101,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 15000,
        payload: { marker: "sched.decision", phaseId: "steady_playback", lookaheadFrames: 4, action: "keep" },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 33100,
        payload: {
          totalFramesPresented: 0,
          totalFramesDropped: 0,
          playback: {
            max_frame_ms: 1050.0, // 1-second freeze
            p99_frame_ms: 75.0,
            consecutive_misses_max: 25,
          },
          previewConcurrency: { dirtyRecoveries: 0 },
          transfers: { zero_copy_guard_violations: 0 },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 33101,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "session-footer",
        timestampEpochMs: 33200,
        payload: { status: "closed" },
      },
    ];

    await writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const result = await evaluateSession(filePath);
    // Should fail both c5 (0 expected frames, ratio n/a) and c11 (freeze > 200ms) and c12 (p99 > 60ms)
    assert.equal(result.criteria.c5_steadyPlaybackPresented.pass, false);
    assert.equal(result.criteria.c11_longestFreeze.pass, false);
    assert.equal(result.criteria.c12_p99InterPresent.pass, false);
    assert.equal(result.phases.steady_playback.presentationRatio, null);
    assert.equal(result.allPassed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluateSession fails when lookahead depth in steady playback is below 2", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-lookahead-"));
  try {
    const filePath = path.join(directory, "session-lookahead-low.ndjson");
    const records = [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: "test-lookahead-low",
          scenarioHash: "hash-lookahead",
          mediaHash: "media123",
          projectHash: "project123",
          projectComputedDuration: 60,
          projectFrameRate: 25,
          mediaFrameRate: 25,
          experimentArmMeaning: "dirty-recovery-enabled",
          resolvedFlags: { CLYPRA_DEBUG_DISABLE_DIRTY_RECOVERY: false },
          build: { perfDriverEnabled: true },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1100,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1500,
        payload: { marker: "native-playback-startup", stage: "first-native-frame-presented", elapsedUs: 400000 },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3100,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3101,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 10000,
        payload: { marker: "sched.decision", phaseId: "steady_playback", lookaheadFrames: 1, action: "start" },
      },
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 33100,
        payload: { workloadSnapshots: { playback: { completedFrames: 750, droppedFrames: 0 } } },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 33100,
        payload: {
          totalFramesPresented: 750,
          totalFramesDropped: 0,
          previewConcurrency: { dirtyRecoveries: 0 },
          transfers: { zero_copy_guard_violations: 0 },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 33101,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "session-footer",
        timestampEpochMs: 33200,
        payload: { status: "closed" },
      },
    ];

    await writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const result = await evaluateSession(filePath);
    assert.equal(result.criteria.c14_lookaheadDepthSteady.pass, false);
    assert.equal(result.allPassed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluateSession fails when lookahead data is missing during steady playback", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-lookahead-missing-"));
  try {
    const filePath = path.join(directory, "session-lookahead-missing.ndjson");
    const records = [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: "test-lookahead-missing",
          scenarioHash: "hash-lookahead",
          mediaHash: "media123",
          projectHash: "project123",
          projectComputedDuration: 60,
          projectFrameRate: 25,
          mediaFrameRate: 25,
          experimentArmMeaning: "dirty-recovery-enabled",
          resolvedFlags: { CLYPRA_DEBUG_DISABLE_DIRTY_RECOVERY: false },
          build: { perfDriverEnabled: true },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1100,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1500,
        payload: { marker: "native-playback-startup", stage: "first-native-frame-presented", elapsedUs: 400000 },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3100,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3101,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 33100,
        payload: { workloadSnapshots: { playback: { completedFrames: 750, droppedFrames: 0 } } },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 33100,
        payload: {
          totalFramesPresented: 750,
          totalFramesDropped: 0,
          previewConcurrency: { dirtyRecoveries: 0 },
          transfers: { zero_copy_guard_violations: 0 },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 33101,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "session-footer",
        timestampEpochMs: 33200,
        payload: { status: "closed" },
      },
    ];

    await writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const result = await evaluateSession(filePath);
    assert.equal(result.criteria.c14_lookaheadDepthSteady.pass, false);
    assert.equal(result.allPassed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluateSession fails when time to first frame marker is missing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-ttff-missing-"));
  try {
    const filePath = path.join(directory, "session-ttff-missing.ndjson");
    const records = [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: "test-ttff-missing",
          scenarioHash: "hash-ttff",
          mediaHash: "media123",
          projectHash: "project123",
          projectComputedDuration: 60,
          projectFrameRate: 25,
          mediaFrameRate: 25,
          experimentArmMeaning: "dirty-recovery-enabled",
          resolvedFlags: { CLYPRA_DEBUG_DISABLE_DIRTY_RECOVERY: false },
          build: { perfDriverEnabled: true },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1100,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3100,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "startup", phaseKind: "startup" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 3101,
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 15000,
        payload: { marker: "sched.decision", phaseId: "steady_playback", lookaheadFrames: 3, action: "keep" },
      },
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 33100,
        payload: { workloadSnapshots: { playback: { completedFrames: 750, droppedFrames: 0 } } },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 33100,
        payload: {
          totalFramesPresented: 750,
          totalFramesDropped: 0,
          previewConcurrency: { dirtyRecoveries: 0 },
          transfers: { zero_copy_guard_violations: 0 },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 33101,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "session-footer",
        timestampEpochMs: 33200,
        payload: { status: "closed" },
      },
    ];

    await writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const result = await evaluateSession(filePath);
    assert.equal(result.criteria.c4_startupPhaseIsolated.pass, false);
    assert.equal(result.criteria.c13_timeToFirstFrame.pass, false);
    assert.equal(result.allPassed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
