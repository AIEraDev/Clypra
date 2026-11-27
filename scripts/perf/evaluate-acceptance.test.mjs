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

test("evaluateSession fails closed on collapsed session with < 2 presented frames", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-collapse-"));
  try {
    const filePath = path.join(directory, "session-collapse.ndjson");
    const records = [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: "test-collapse-1",
          scenarioHash: "hash-collapse",
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
        timestampEpochMs: 3101,
        payload: { workloadSnapshots: { playback: { completedFrames: 0, droppedFrames: 0 } } },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 15000,
        payload: { marker: "sched.decision", phaseId: "steady_playback", lookaheadFrames: 4, action: "keep" },
      },
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 33100,
        payload: { workloadSnapshots: { playback: { completedFrames: 1, droppedFrames: 621 } } },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 33100,
        payload: {
          totalFramesPresented: 1,
          totalFramesDropped: 621,
          playback: {
            max_frame_ms: 14.34, // 14ms render time for single frame
            p99_frame_ms: 14.34,
            consecutive_misses_max: 0,
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
    assert.equal(result.criteria.c5_steadyPlaybackPresented.pass, false);
    assert.equal(result.criteria.c11_longestFreeze.pass, false);
    assert.equal(result.criteria.c12_p99InterPresent.pass, false);
    assert.match(result.criteria.c11_longestFreeze.actual, /insufficient presents/);
    assert.match(result.criteria.c12_p99InterPresent.actual, /insufficient presents/);
    assert.equal(result.allPassed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluateSession correctly handles scrub and seek scenarios", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-seek-"));
  try {
    const filePath = path.join(directory, "session-seek.ndjson");
    const records = [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: "test-seek-1",
          scenarioHash: "seek123hash",
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
        payload: { marker: "perf-phase", phaseEvent: "start", phaseId: "cold_seek", phaseKind: "coldSeek" },
      },
      {
        kind: "seek-span",
        timestampEpochMs: 1300,
        payload: {
          workload: { mode: "seek-cold" },
        },
      },
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 1400,
        payload: {
          workloadSnapshots: {
            playback: { completedFrames: 1, droppedFrames: 0 },
          },
        },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 1400,
        payload: {
          totalFramesPresented: 1,
          totalFramesDropped: 0,
          playback: {
            max_frame_ms: 2.5,
            p99_frame_ms: 2.5,
            consecutive_misses_max: 0,
          },
          previewConcurrency: { dirtyRecoveries: 0 },
          transfers: { zero_copy_guard_violations: 0 },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 1401,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "cold_seek", phaseKind: "coldSeek" },
      },
      {
        kind: "session-footer",
        timestampEpochMs: 1500,
        payload: { status: "closed" },
      },
    ];

    await writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const result = await evaluateSession(filePath);
    assert.equal(result.allPassed, true);
    assert.equal(result.criteria.c4_startupPhaseIsolated.pass, true);
    assert.equal(result.criteria.c5_steadyPlaybackPresented.pass, true);
    assert.equal(result.criteria.c6_dirtyRecoveries.pass, true);
    assert.equal(result.criteria.c11_longestFreeze.pass, true);
    assert.equal(result.criteria.c12_p99InterPresent.pass, true);
    assert.equal(result.criteria.c13_timeToFirstFrame.pass, true);
    assert.equal(result.criteria.c14_lookaheadDepthSteady.pass, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluateSession applies c12 2x floor only when drop ratio exceeds 5%", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-c12-drop-"));
  try {
    const makeRecords = (presented, dropped) => {
      const steps = 15;
      const midRecords = [];
      for (let i = 1; i < steps; i++) {
        midRecords.push({
          kind: "native-session-telemetry",
          timestampEpochMs: 3101 + i * 2000,
          payload: {
            workloadSnapshots: {
              playback: {
                completedFrames: Math.round((presented * i) / steps),
                droppedFrames: Math.round((dropped * i) / steps),
              },
            },
          },
        });
      }
      return [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: `test-c12-${presented}-${dropped}`,
          scenarioHash: "c12hash",
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
        timestampEpochMs: 1400,
        payload: { marker: "native-playback-startup", stage: "first-native-frame-presented", elapsedUs: 300000 },
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
        payload: { marker: "sched.decision", phaseId: "steady_playback", lookaheadFrames: 4, action: "keep" },
      },
      ...midRecords,
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 33100,
        payload: { workloadSnapshots: { playback: { completedFrames: presented, droppedFrames: dropped } } },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 33100,
        payload: {
          totalFramesPresented: presented,
          totalFramesDropped: dropped,
          playback: {
            max_frame_ms: 8.0,
            p99_frame_ms: 6.5,
            consecutive_misses_max: 0,
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
    };

    // 1.9% drops (14 / 750) should NOT trigger the 2x 80ms floor when raw p99 is healthy
    const nearCleanPath = path.join(directory, "near-clean.ndjson");
    await writeFile(nearCleanPath, makeRecords(736, 14).map((r) => JSON.stringify(r)).join("\n") + "\n");
    const nearClean = await evaluateSession(nearCleanPath);
    assert.equal(nearClean.criteria.c12_p99InterPresent.pass, true);
    assert.equal(nearClean.allPassed, true);

    // 6.0% drops (45 / 750) MUST trigger the 2x (80ms) floor and fail c12 (> 60ms)
    const heavyDropPath = path.join(directory, "heavy-drop.ndjson");
    await writeFile(heavyDropPath, makeRecords(705, 45).map((r) => JSON.stringify(r)).join("\n") + "\n");
    const heavyDrop = await evaluateSession(heavyDropPath);
    assert.equal(heavyDrop.criteria.c12_p99InterPresent.pass, false);
    assert.equal(heavyDrop.criteria.c12_p99InterPresent.actual, "80.00ms");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 — maxDroppedBurst: 30 s NST interval (release polling) must NOT
//           count scattered drops as a consecutive burst
//
// Regression guard for the evaluator fix that added `isConsecutive` logic.
// In release builds, perfLogService.ts polls native-session-telemetry every
// 30 000 ms.  20 scattered drops across a 25 s interval while
// consecutive_misses_max === 0 must NOT trigger c11_longestFreeze.
// ─────────────────────────────────────────────────────────────────────────────
test("Test 11 — 20 scattered drops over a 25 s NST interval with consecutive_misses_max=0 do NOT fail c11_longestFreeze", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-test11-"));
  try {
    const projectFps = 25;
    const presented = 600; // frames presented on-time
    const dropped = 20;    // scattered drops — none consecutive
    // A single NST record at +28 000 ms carries the cumulative drop counter.
    // The gap from burstStartTs (~3 100 ms) to this record is ~25 000 ms, well
    // above the 2 500 ms threshold, and completed > lastCompleted (600 frames
    // presented between the two polls), so no burst should be attributed.
    const records = [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: "test11-scattered-drops",
          scenarioHash: "t11hash",
          mediaHash: "media123hash",
          projectHash: "project123hash",
          projectComputedDuration: 60,
          projectFrameRate: projectFps,
          mediaFrameRate: projectFps,
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
        timestampEpochMs: 1400,
        payload: { marker: "native-playback-startup", stage: "first-native-frame-presented", elapsedUs: 300000 },
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
      // Baseline NST poll at start of steady playback
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
      // Mid-playback lookahead diagnostic so c14 passes
      {
        kind: "native-diagnostic",
        timestampEpochMs: 15000,
        payload: { marker: "sched.decision", phaseId: "steady_playback", lookaheadFrames: 4, action: "keep" },
      },
      // Second NST poll ~25 000 ms later (release-mode polling cadence).
      // 600 frames presented, 20 scattered drops — none consecutive.
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 28100,
        payload: { workloadSnapshots: { playback: { completedFrames: presented, droppedFrames: dropped } } },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 28100,
        payload: {
          totalFramesPresented: presented,
          totalFramesDropped: dropped,
          playback: {
            max_frame_ms: 10.0,
            p99_frame_ms: 7.0,
            consecutive_misses_max: 0,
          },
          previewConcurrency: { dirtyRecoveries: 0 },
          transfers: { zero_copy_guard_violations: 0 },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 28200,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "session-footer",
        timestampEpochMs: 28300,
        payload: { status: "closed" },
      },
    ];

    const filePath = path.join(directory, "release-nst-scattered.ndjson");
    await writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const result = await evaluateSession(filePath);

    // 20 drops over 25 s with 600 frames presented is not a consecutive stall.
    // Only c11_longestFreeze is asserted here; other criteria rely on harness
    // fields out of scope for this regression test.
    assert.equal(
      result.criteria.c11_longestFreeze.pass,
      true,
      `c11_longestFreeze should pass for scattered drops; actual=${result.criteria.c11_longestFreeze.actual}`
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12 — maxDroppedBurst: truly consecutive drops (closely-spaced NST)
//           MUST still fail c11_longestFreeze
//
// Verifies the inverse: when polls arrive every ~1 000 ms and frames stop
// presenting (completedFrames unchanged), the burst IS detected.
// ─────────────────────────────────────────────────────────────────────────────
test("Test 12 — 10 consecutive drops with zero completedFrames between polls correctly fails c11_longestFreeze", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clypra-eval-test12-"));
  try {
    const projectFps = 25;
    // frameIntervalMs = 40 ms; freeze = (10+1)*40 = 440 ms > threshold (200 ms).
    // The two NST polls are 1 000 ms apart (≤ 2 500 ms threshold) AND
    // completedFrames is unchanged (zero frames presented) → isConsecutive = true.
    const records = [
      {
        kind: "session-header",
        timestampEpochMs: 1000,
        payload: {
          sessionId: "test12-consecutive-freeze",
          scenarioHash: "t12hash",
          mediaHash: "media123hash",
          projectHash: "project123hash",
          projectComputedDuration: 60,
          projectFrameRate: projectFps,
          mediaFrameRate: projectFps,
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
        timestampEpochMs: 1400,
        payload: { marker: "native-playback-startup", stage: "first-native-frame-presented", elapsedUs: 300000 },
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
      // Baseline NST — 100 frames already presented before steady phase
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 3101,
        payload: { workloadSnapshots: { playback: { completedFrames: 100, droppedFrames: 0 } } },
      },
      {
        kind: "engine-telemetry",
        timestampEpochMs: 3101,
        payload: { previewConcurrency: { dirtyRecoveries: 0 } },
      },
      // 1 000 ms later: 10 drops, completedFrames unchanged → true consecutive freeze
      {
        kind: "native-session-telemetry",
        timestampEpochMs: 4101,
        payload: { workloadSnapshots: { playback: { completedFrames: 100, droppedFrames: 10 } } },
      },
      // Final engine-telemetry + phase end
      {
        kind: "engine-telemetry",
        timestampEpochMs: 8000,
        payload: {
          totalFramesPresented: 200,
          totalFramesDropped: 10,
          playback: {
            max_frame_ms: 10.0,
            p99_frame_ms: 7.0,
            consecutive_misses_max: 10,
          },
          previewConcurrency: { dirtyRecoveries: 0 },
          transfers: { zero_copy_guard_violations: 0 },
        },
      },
      {
        kind: "native-diagnostic",
        timestampEpochMs: 8001,
        payload: { marker: "perf-phase", phaseEvent: "end", phaseId: "steady_playback", phaseKind: "play" },
      },
      {
        kind: "session-footer",
        timestampEpochMs: 8100,
        payload: { status: "closed" },
      },
    ];

    const filePath = path.join(directory, "consecutive-freeze.ndjson");
    await writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const result = await evaluateSession(filePath);

    // 10 consecutive drops at 25 fps = 440 ms freeze — must fail c11
    assert.equal(
      result.criteria.c11_longestFreeze.pass,
      false,
      `c11_longestFreeze should fail for a true 10-frame stall; actual=${result.criteria.c11_longestFreeze.actual}`
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
