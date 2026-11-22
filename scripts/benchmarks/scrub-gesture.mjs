/**
 * Deterministic scrub gesture and native-session validity helpers.
 *
 * The gesture is intentionally expressed as data so the same points can be
 * replayed by the Playwright browser harness and recorded beside a native
 * desktop run. This file does not change preview scheduling or decoder policy.
 */

export const SCRUB_GESTURE_SCHEMA_VERSION = 1;

export function buildScrubGesture({
  direction,
  startX = direction === "backward" ? 980 : 260,
  endX = direction === "backward" ? 260 : 980,
  y = 12,
  steps = 48,
  durationMs = 1_200,
  pointerId = 1,
} = {}) {
  if (direction !== "forward" && direction !== "backward") {
    throw new Error("direction must be forward or backward");
  }
  if (!Number.isFinite(startX) || !Number.isFinite(endX) || !Number.isFinite(y)) {
    throw new Error("gesture coordinates must be finite");
  }
  if (!Number.isInteger(steps) || steps < 2) {
    throw new Error("steps must be an integer >= 2");
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("durationMs must be positive");
  }

  const points = Array.from({ length: steps }, (_, index) => {
    const progress = index / (steps - 1);
    return {
      x: Number((startX + (endX - startX) * progress).toFixed(3)),
      y: Number(y.toFixed(3)),
      offsetMs: Math.round(progress * durationMs),
    };
  });

  return {
    schemaVersion: SCRUB_GESTURE_SCHEMA_VERSION,
    pointerId,
    direction,
    startX,
    endX,
    y,
    steps,
    durationMs,
    points,
  };
}

function payloads(records) {
  return records.map((record) => record?.payload ?? record ?? {});
}

function contextOf(payload) {
  return payload.experimentContext ?? payload.experiment_context ?? null;
}

function sameContext(actual, expected) {
  return Boolean(
    actual &&
      actual.experimentId === expected.experimentId &&
      actual.runId === expected.runId &&
      actual.cacheCleared === expected.cacheCleared &&
      actual.backgroundDecodeDisabled === expected.backgroundDecodeDisabled,
  );
}

function profileKey(payload) {
  const profile = payload.video ?? payload.profile ?? payload.mediaProfile ?? payload.workload?.profile ?? payload;
  const fields = ["codec", "width", "height", "nominalFps", "fps", "bitDepth", "presenter"];
  const values = fields.map((field) => field === "presenter"
    ? (profile?.[field] ?? payload.presenter ?? payload.workload?.presenter ?? payload.previewContext?.presenterMode)
    : profile?.[field]);
  if (values.every((value) => value === undefined || value === null)) return null;
  return JSON.stringify(Object.fromEntries(fields.map((field, index) => [field, values[index] ?? null])));
}

/**
 * Validate only the operation(s) carrying the expected experiment context.
 * Old/uncontrolled records are never treated as evidence for a controlled run.
 */
export function validateControlledSession(records, expected, options = {}) {
  const errors = [];
  const checks = {};
  const payloadList = payloads(records);
  const contexts = payloadList.map(contextOf).filter(Boolean);
  const matchingContexts = contexts.filter((context) => sameContext(context, expected));
  checks.experimentContext = matchingContexts.length > 0;
  if (!checks.experimentContext) {
    errors.push("no telemetry record carries the expected experiment context");
  }

  const traces = records
    .filter((record) => record?.kind === "playback-trace")
    .map((record) => record.payload ?? {});
  const dispatches = new Map(
    traces
      .filter((trace) => trace.event === "native-demand-dispatched" && trace.operationId)
      .map((trace) => [trace.operationId, trace]),
  );
  const terminals = traces.filter(
    (trace) => trace.event === "native-demand-terminal" && sameContext(contextOf(trace), expected),
  );
  const operationIds = new Set(terminals.map((trace) => trace.operationId).filter(Boolean));
  const scopedDispatches = [...operationIds].map((operationId) => dispatches.get(operationId)).filter(Boolean);
  checks.hasScopedDemand = terminals.length > 0;
  if (!checks.hasScopedDemand) errors.push("no typed terminal demand carries the expected experiment context");

  checks.dispatchTerminalCoverage = scopedDispatches.length === terminals.length;
  if (!checks.dispatchTerminalCoverage) {
    errors.push(`expected one dispatch for each scoped terminal (${scopedDispatches.length}/${terminals.length})`);
  }

  const directions = [...new Set(terminals.map((trace) => trace.scrubDirection).filter(Boolean))];
  checks.directionRecorded = terminals.every((trace) => typeof trace.scrubDirection === "string");
  if (!checks.directionRecorded) errors.push("one or more scoped terminals is missing scrubDirection");
  if (expected.direction && directions.some((direction) => direction !== expected.direction)) {
    errors.push(`scoped terminals contain unexpected directions: ${directions.join(", ")}`);
  }

  const terminalIds = new Set(terminals.map((trace) => trace.operationId).filter(Boolean));
  const abandoned = traces.filter(
    (trace) => trace.event === "native-demand-abandoned" &&
      (sameContext(contextOf(trace), expected) || terminalIds.has(trace.operationId)),
  );
  const abandonedIds = new Set(abandoned.map((trace) => trace.operationId));
  checks.noUnmatchedAbandoned = abandoned.every((trace) => terminalIds.has(trace.operationId));
  checks.noDuplicateTerminals = terminalIds.size === terminals.length;
  if (!checks.noDuplicateTerminals) errors.push("scoped operation IDs have duplicate terminal events");
  if (!checks.noUnmatchedAbandoned) errors.push("an abandoned scoped operation has no matching terminal");

  const outcomes = Object.create(null);
  for (const terminal of terminals) outcomes[terminal.outcome ?? "missing"] = (outcomes[terminal.outcome ?? "missing"] ?? 0) + 1;
  checks.typedOutcome = terminals.every((trace) => ["presented", "superseded", "cancelled", "failed"].includes(trace.outcome));
  if (!checks.typedOutcome) errors.push("one or more scoped terminals has an unknown outcome");

  const profileKeys = [...new Set(payloadList.map(profileKey).filter(Boolean))];
  checks.singleMediaProfile = options.allowMixedMedia === true || profileKeys.length <= 1;
  if (!checks.singleMediaProfile) errors.push(`multiple media profiles recorded (${profileKeys.length})`);

  const presenters = [...new Set(payloadList.map((payload) => payload.presenter ?? payload.activePresenter ?? payload.workload?.presenter ?? payload.previewContext?.surface ?? payload.previewContext?.presenterMode).filter(Boolean))];
  checks.nativePresenter = options.requireNativePresenter === false || presenters.includes("native-surface");
  if (!checks.nativePresenter) errors.push("native-surface is not explicitly recorded as the active presenter");

  const terminalCount = terminals.length;
  const requestCounter = payloadList
    .filter((payload) => payload.workload?.requestsReceived != null || payload.requestsReceived != null)
    .at(-1);
  const received = requestCounter?.workload?.requestsReceived ?? requestCounter?.requestsReceived ?? null;
  checks.typedAccounting = received == null || received === terminalCount;
  if (!checks.typedAccounting) errors.push(`requestsReceived ${received} does not equal scoped terminal count ${terminalCount}`);

  return {
    valid: errors.length === 0,
    errors,
    checks,
    expected,
    contextCount: matchingContexts.length,
    scoped: {
      dispatches: scopedDispatches.length,
      terminals: terminalCount,
      abandoned: abandonedIds.size,
      directions,
      outcomes,
      mediaProfiles: profileKeys,
      presenters,
    },
  };
}

