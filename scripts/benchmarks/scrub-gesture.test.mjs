import test from "node:test";
import assert from "node:assert/strict";
import { buildScrubGesture, validateControlledSession } from "./scrub-gesture.mjs";

test("buildScrubGesture is deterministic and directionally monotonic", () => {
  const forward = buildScrubGesture({ direction: "forward", startX: 10, endX: 110, steps: 5, durationMs: 100 });
  const backward = buildScrubGesture({ direction: "backward", startX: 110, endX: 10, steps: 5, durationMs: 100 });
  assert.deepEqual(forward.points.map((point) => point.x), [10, 35, 60, 85, 110]);
  assert.deepEqual(backward.points.map((point) => point.x), [110, 85, 60, 35, 10]);
  assert.deepEqual(forward.points.map((point) => point.offsetMs), [0, 25, 50, 75, 100]);
});

test("validateControlledSession rejects missing context and unbalanced lifecycle", () => {
  const expected = { experimentId: "scrub-v1", runId: "run-01", cacheCleared: true, backgroundDecodeDisabled: true, direction: "forward" };
  const result = validateControlledSession([
    { kind: "playback-trace", payload: { event: "native-demand-dispatched", operationId: "op-1", scrubDirection: "forward" } },
  ], expected, { requireNativePresenter: false });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("; "), /experiment context/);
  assert.match(result.errors.join("; "), /terminal demand/);
});

test("validateControlledSession accepts a balanced typed terminal", () => {
  const expected = { experimentId: "scrub-v1", runId: "run-01", cacheCleared: true, backgroundDecodeDisabled: true, direction: "forward" };
  const context = { experimentId: "scrub-v1", runId: "run-01", cacheCleared: true, backgroundDecodeDisabled: true };
  const records = [
    { kind: "frontend-rollup", payload: { codec: "h264", width: 1920, height: 1080, nominalFps: 30, bitDepth: 8, presenter: "native-surface", experimentContext: context } },
    { kind: "playback-trace", payload: { event: "native-demand-dispatched", operationId: "op-1", scrubDirection: "forward" } },
    { kind: "playback-trace", payload: { event: "native-demand-terminal", operationId: "op-1", scrubDirection: "forward", outcome: "presented", experimentContext: context } },
  ];
  const result = validateControlledSession(records, expected);
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("validateControlledSession rejects a context-scoped abandoned demand without a terminal", () => {
  const expected = { experimentId: "scrub-v1", runId: "run-02", cacheCleared: true, backgroundDecodeDisabled: true, direction: "backward" };
  const context = { experimentId: "scrub-v1", runId: "run-02", cacheCleared: true, backgroundDecodeDisabled: true };
  const result = validateControlledSession([
    { kind: "playback-trace", payload: { event: "native-demand-abandoned", operationId: "op-2", scrubDirection: "backward", experimentContext: context } },
  ], expected, { requireNativePresenter: false });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("; "), /terminal demand/);
  assert.equal(result.checks.noUnmatchedAbandoned, false);
});

