import test from "node:test";
import assert from "node:assert/strict";
import { lintRecords } from "./clypra-perf.mjs";

function header() {
  return {
    schemaVersion: 2,
    kind: "session-header",
    sessionId: "session-test",
    timestampEpochMs: 100,
    seq: 0,
    scope: "diagnostics.writer",
    payload: {
      schemaVersion: 2,
      sessionId: "session-test",
      openedAtEpochMs: 100,
    },
  };
}

test("lint accepts a self-describing session with declared preview context", () => {
  const report = lintRecords([
    header(),
    {
      schemaVersion: 2,
      kind: "preview-context",
      sessionId: "session-test",
      timestampEpochMs: 110,
      seq: 1,
      scope: "diagnostics.writer",
      payload: {
        previewContextId: 1,
        streamKeys: ["stream-a"],
      },
    },
    {
      schemaVersion: 2,
      kind: "frame",
      sessionId: "session-test",
      timestampEpochMs: 120,
      seq: 2,
      scope: "engine.native",
      payload: {
        previewContextId: 1,
        streamKey: "stream-a",
      },
    },
    {
      schemaVersion: 2,
      kind: "native-diagnostic",
      sessionId: "session-test",
      timestampEpochMs: 130,
      seq: 3,
      scope: "bridge.ipc",
      payload: { marker: "session-close" },
    },
  ]);

  assert.equal(report.trusted, true);
  assert.equal(report.evidenceGrade, "measured");
  assert.deepEqual(report.errors, []);
  assert.equal(report.completionStatus, "complete");
});

test("lint rejects a frame that references an undeclared context", () => {
  const report = lintRecords([
    header(),
    {
      schemaVersion: 2,
      kind: "frame",
      sessionId: "session-test",
      timestampEpochMs: 120,
      seq: 1,
      scope: "engine.native",
      payload: { previewContextId: 99 },
    },
  ]);

  assert.equal(report.trusted, false);
  assert.ok(report.errors.some((issue) => issue.code === "unknown-preview-context"));
});

test("lint rejects unsupported schema and inconsistent header provenance", () => {
  const report = lintRecords([
    {
      ...header(),
      payload: { schemaVersion: 2, sessionId: "other-session" },
    },
    {
      schemaVersion: 3,
      kind: "interval",
      sessionId: "session-test",
      timestampEpochMs: 120,
      seq: 1,
      scope: "engine.native",
      payload: {},
    },
  ]);

  assert.equal(report.trusted, false);
  assert.ok(report.errors.some((issue) => issue.code === "unsupported-schema-version"));
  assert.ok(report.errors.some((issue) => issue.code === "header-session-mismatch"));
});

test("legacy wrapped sessions remain analyzable but untrusted", () => {
  const report = lintRecords([
    {
      kind: "native-diagnostic",
      sessionId: "legacy-session",
      timestampEpochMs: 100,
      payload: { marker: "session-open" },
    },
  ]);

  assert.equal(report.trusted, false);
  assert.ok(report.warnings.some((issue) => issue.code === "legacy-session-header"));
});

test("v2 sessions without a close marker are incomplete and untrusted", () => {
  const report = lintRecords([header()]);
  assert.equal(report.trusted, false);
  assert.equal(report.evidenceGrade, "untrusted");
  assert.equal(report.completionStatus, "incomplete");
  assert.ok(report.warnings.some((issue) => issue.code === "incomplete-session"));
});

test("lint reconciles decode outcomes and transfer call sites", () => {
  const report = lintRecords([
    header(),
    {
      schemaVersion: 2,
      kind: "engine-telemetry",
      sessionId: "session-test",
      timestampEpochMs: 110,
      seq: 1,
      scope: "engine.native",
      payload: {
        playback: { total_frames: 10 },
        transfers: {
          metal_decode_attempts: 5,
          metal_decode_successes: 2,
          metal_decode_failures: 1,
          hwframe_transfer_calls_by_site: { unknown: 1 },
        },
      },
    },
    {
      schemaVersion: 2,
      kind: "native-diagnostic",
      sessionId: "session-test",
      timestampEpochMs: 120,
      seq: 2,
      scope: "bridge.ipc",
      payload: { marker: "session-close" },
    },
  ]);

  assert.ok(report.errors.some((issue) => issue.code === "counter-reconciliation"));
  assert.ok(report.errors.some((issue) => issue.code === "unknown-transfer-site"));
});

test("lint accepts explicitly unrecorded decode outcomes", () => {
  const report = lintRecords([
    header(),
    {
      schemaVersion: 2,
      kind: "engine-telemetry",
      sessionId: "session-test",
      timestampEpochMs: 110,
      seq: 1,
      scope: "engine.native",
      payload: {
        playback: { total_frames: 1 },
        transfers: {
          metal_decode_attempts: 3,
          metal_decode_successes: 1,
          metal_decode_failures: 1,
          metal_decode_unrecorded: 1,
          hwframe_transfer_calls_by_site: {},
        },
      },
    },
    {
      schemaVersion: 2,
      kind: "native-diagnostic",
      sessionId: "session-test",
      timestampEpochMs: 120,
      seq: 2,
      scope: "bridge.ipc",
      payload: { marker: "session-close" },
    },
  ]);

  assert.equal(report.errors.length, 0);
  assert.equal(report.evidenceGrade, "measured");
});

test("lint rejects a FourCC that contradicts a declared P010 stream", () => {
  const report = lintRecords([
    header(),
    {
      schemaVersion: 2,
      kind: "engine-telemetry",
      sessionId: "session-test",
      timestampEpochMs: 110,
      seq: 1,
      scope: "engine.native",
      payload: {
        streams: [{ streamKey: "main", sw_format: "p010le" }],
      },
    },
    {
      schemaVersion: 2,
      kind: "frame",
      sessionId: "session-test",
      timestampEpochMs: 120,
      seq: 2,
      scope: "engine.native",
      payload: { streamKey: "main", cvPixelFormat: "420v" },
    },
    {
      schemaVersion: 2,
      kind: "native-diagnostic",
      sessionId: "session-test",
      timestampEpochMs: 130,
      seq: 3,
      scope: "bridge.ipc",
      payload: { marker: "session-close" },
    },
  ]);

  assert.ok(report.errors.some((issue) => issue.code === "stream-format-mismatch"));
});
