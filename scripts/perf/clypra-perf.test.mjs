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

function footer(seq = 4) {
  return {
    schemaVersion: 2,
    kind: "session-footer",
    sessionId: "session-test",
    timestampEpochMs: 140,
    seq,
    scope: "diagnostics.writer",
    payload: { status: "closed" },
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
    footer(),
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

test("lint rejects explicitly unrecorded decode outcomes", () => {
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

  assert.ok(
    report.errors.some((issue) => issue.code === "unrecorded-decode-outcome"),
  );
  assert.equal(report.evidenceGrade, "untrusted");
});

test("lint requires zero playback transfers and no guard violations", () => {
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
          metal_decode_attempts: 1,
          metal_decode_successes: 1,
          metal_decode_failures: 0,
          metal_decode_unrecorded: 0,
          metal_decode_in_flight_at_close: 0,
          zero_copy_guard_violations: 1,
          hwframe_transfer_calls_by_site: { playback: 1 },
        },
      },
    },
    {
      schemaVersion: 2,
      kind: "zero-copy-violation",
      sessionId: "session-test",
      timestampEpochMs: 115,
      seq: 2,
      scope: "engine.native",
      payload: { frameIndex: 1 },
    },
    {
      schemaVersion: 2,
      kind: "native-diagnostic",
      sessionId: "session-test",
      timestampEpochMs: 120,
      seq: 3,
      scope: "bridge.ipc",
      payload: { marker: "session-close" },
    },
  ]);

  assert.ok(report.errors.some((issue) => issue.code === "playback-transfer"));
  assert.ok(report.errors.some((issue) => issue.code === "zero-copy-guard-violation"));
});

test("lint rejects unknown producer paths", () => {
  const report = lintRecords([
    header(),
    {
      schemaVersion: 2,
      kind: "engine-telemetry",
      sessionId: "session-test",
      timestampEpochMs: 110,
      seq: 1,
      scope: "engine.native",
      payload: { transfers: { unknown_frames: 1 } },
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
    footer(3),
  ]);
  assert.ok(report.errors.some((issue) => issue.code === "unknown-frame-path"));
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

test("lint enforces build provenance and minimum frame evidence", () => {
  const records = [
    {
      ...header(),
      payload: {
        ...header().payload,
        build: {
          gitCommit: "abc123",
          gitTree: "tree123",
          gitDirty: true,
          gitDiffHash: "diff123",
        },
      },
    },
    {
      schemaVersion: 2,
      kind: "native-diagnostic",
      sessionId: "session-test",
      timestampEpochMs: 110,
      seq: 1,
      scope: "bridge.ipc",
      payload: { marker: "session-close" },
    },
  ];
  const report = lintRecords(records, {
    expectedHead: "abc123",
    expectedTree: "tree123",
    requireClean: true,
    minFrameSamples: 1,
  });

  assert.ok(report.errors.some((issue) => issue.code === "dirty-build"));
  assert.ok(report.errors.some((issue) => issue.code === "dirty-diff-hash"));
  assert.ok(report.errors.some((issue) => issue.code === "insufficient-frame-samples"));
  assert.equal(report.frameSampleCount, 0);
});

test("lint grades unverified capability sessions as validation-only", () => {
  const validationHeader = header();
  validationHeader.payload.unverifiedCapabilityOverride = true;
  const report = lintRecords([
    validationHeader,
    {
      schemaVersion: 2,
      kind: "native-diagnostic",
      sessionId: "session-test",
      timestampEpochMs: 110,
      seq: 1,
      scope: "bridge.ipc",
      payload: { marker: "session-close" },
    },
    footer(2),
  ]);
  assert.equal(report.trusted, false);
  assert.equal(report.evidenceGrade, "validation");
  assert.ok(report.warnings.some((issue) => issue.code === "unverified-capability-override"));
});
