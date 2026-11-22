#!/usr/bin/env node

/**
 * Compare the three dirty-recovery experiment arms without mixing provenance.
 * Each arm must point at session NDJSON files produced by the same scenario
 * hash and instrumentation patch. The first `--warmups` files are discarded
 * per arm; the remaining runs are summarized by median and range.
 */

import { readFile } from "node:fs/promises";

// Pre-registered before experiment runs. Keep this identifier stable when
// comparing results so a report cannot silently mix decision thresholds.
export const DECISION_RULE_ID = "dirty-recovery-v1";
export const DROPPED_RATIO_REGRESSION_FACTOR = 1.2;
export const PRESENTED_FRAME_REGRESSION_FACTOR = 0.8;

function valueAfter(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function number(...values) {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function range(values) {
  return { min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0 };
}

async function readSession(file) {
  const records = (await readFile(file, "utf8"))
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const header = records.find((record) => record.kind === "session-header")?.payload ?? {};
  const engine = records.filter((record) => record.kind === "engine-telemetry").at(-1)?.payload ?? {};
  const transfers = engine.transfers ?? {};
  const concurrency = engine.previewConcurrency ?? engine.preview_concurrency ?? {};
  const rollups = records.filter((record) => ["frontend-rollup", "preview-benchmark-report"].includes(record.kind));
  const frontend = rollups.at(-1)?.payload ?? {};
  const workload = frontend.workload ?? frontend.preview ?? {};
  const footer = records.filter((record) => record.kind === "session-footer").at(-1)?.payload ?? {};
  const cpuNv12 = number(transfers.cpu_nv12_frames, transfers.cpuNv12Frames);
  const cpuP010 = number(transfers.cpu_p010_frames, transfers.cpuP010Frames);
  const playbackTransfers = number(
    transfers.hwframe_transfer_calls_by_site?.playback,
    transfers.hwframeTransferCallsBySite?.playback,
  );
  const streams = Array.isArray(engine.streams) ? engine.streams : [];
  const streamPaths = streams
    .map((stream) => stream.decode_path_chosen ?? stream.decodePathChosen)
    .filter((path) => typeof path === "string");
  return {
    file,
    scenarioHash: header.scenarioHash ?? null,
    effectiveDecodePolicy: header.decodePolicyEffective ?? header.decodePolicy ?? null,
    instrumentationPatchHash: header.build?.instrumentationPatchHash ?? null,
    binaryHash: header.build?.binaryHash ?? null,
    ffmpegCallbackVerified: header.ffmpegCallbackVerified === true,
    thermalState: header.system?.thermalState ?? "unknown",
    mediaHash: header.mediaHash ?? null,
    projectHash: header.projectHash ?? null,
    droppedRatio: number(workload.droppedFramesRatio, frontend.droppedFramesRatio, frontend.dropRatePct != null ? frontend.dropRatePct / 100 : null),
    presentedFrames: number(workload.totalFrames, frontend.totalFrames, engine.playback?.presented_frames),
    cancelled: number(transfers.metal_decode_cancelled, transfers.metalDecodeCancelled, engine.cancellation?.cancelled),
    pocErrors: number(engine.decodeIncidents?.pocErrors, engine.decode_incidents?.poc_errors),
    rpsErrors: number(engine.decodeIncidents?.rpsErrors, engine.decode_incidents?.rps_errors),
    dirtyRecoveries: number(concurrency.dirtyRecoveries, concurrency.dirty_recoveries),
    invalidations: concurrency.lookaheadInvalidationsByCause ?? concurrency.lookahead_invalidations_by_cause ?? {},
    cpuFrames: cpuNv12 + cpuP010,
    playbackTransfers,
    demotions: number(transfers.decode_path_demotions, transfers.decodePathDemotions, engine.decodePathDemotions),
    unrecorded: number(transfers.metal_decode_unrecorded, transfers.metalDecodeUnrecorded),
    inFlightAtClose: number(transfers.metal_decode_in_flight_at_close, transfers.metalDecodeInFlightAtClose),
    streamPaths,
    footerStatus: footer.status ?? null,
    unverifiedOverride: header.unverifiedCapabilityOverride === true,
    devProfile:
      header.devProfile === true
      || header.runtimeProfile === "dev"
      || (header.devProfile === undefined && header.build?.debugAssertions === true),
  };
}

function integrityFailures(session) {
  const failures = [];
  if (session.cpuFrames > 0) failures.push(`cpu video frames=${session.cpuFrames}`);
  if (session.playbackTransfers > 0) failures.push(`playback transfers=${session.playbackTransfers}`);
  if (session.demotions > 0) failures.push(`path demotions=${session.demotions}`);
  if (session.unrecorded > 0) failures.push(`unrecorded outcomes=${session.unrecorded}`);
  if (session.inFlightAtClose > 0) failures.push(`in-flight outcomes=${session.inFlightAtClose}`);
  if (session.unverifiedOverride) failures.push("unverified capability override");
  if (session.devProfile) failures.push("dev profile session is not benchmark-grade");
  if (session.footerStatus !== "closed") {
    failures.push(`footer status=${session.footerStatus}`);
  }
  if (session.streamPaths.some((path) => !path.startsWith("metal-zero-copy") && path !== "dxgi-zero-copy")) {
    failures.push(`non-native stream paths=${session.streamPaths.join(",")}`);
  }
  return failures;
}

function summarize(sessions) {
  const fields = ["droppedRatio", "presentedFrames", "cancelled", "pocErrors", "rpsErrors", "dirtyRecoveries"];
  const summary = {};
  for (const field of fields) {
    const values = sessions.map((session) => session[field]);
    summary[field] = { median: median(values), ...range(values), values };
  }
  summary.invalidationCauses = sessions.reduce((result, session) => {
    for (const [cause, count] of Object.entries(session.invalidations)) result[cause] = (result[cause] ?? 0) + count;
    return result;
  }, {});
  return summary;
}

function decision(arms) {
  const dirtyOn = arms.B;
  const dirtyOff = arms.C;
  const baseline = arms.A;
  if (!dirtyOn || !dirtyOff || !baseline) return { status: "insufficient-data", reason: "A, B and C each require measured runs" };
  const dirtyCorrectnessChanged = dirtyOn.pocErrors.median !== dirtyOff.pocErrors.median || dirtyOn.rpsErrors.median !== dirtyOff.rpsErrors.median;
  const dirtyPerformanceWorse =
    dirtyOn.droppedRatio.median > dirtyOff.droppedRatio.median * DROPPED_RATIO_REGRESSION_FACTOR
    || dirtyOn.presentedFrames.median < dirtyOff.presentedFrames.median * PRESENTED_FRAME_REGRESSION_FACTOR;
  if (dirtyCorrectnessChanged) return { status: "keep-dirty-recovery", reason: "POC/RPS outcomes differ between dirty-on and dirty-off; investigate packet-boundary cancellation before relaxing recovery", dirtyPerformanceWorse };
  if (dirtyPerformanceWorse) return { status: "packet-boundary-cancellation", reason: "dirty recovery worsens stale-display outcomes without changing decoder incidents", dirtyPerformanceWorse };
  return { status: "investigate-invalidation", reason: "dirty recovery does not explain the regression; inspect per-cause lookahead invalidations", dirtyPerformanceWorse };
}

export async function compareArms({ arms, warmups = 1, minRuns = 5 }) {
  const loaded = {};
  const allMeasured = [];
  for (const [arm, files] of Object.entries(arms)) {
    const sessions = await Promise.all(files.map(readSession));
    const eligible = sessions.filter((session) => session.thermalState === "nominal");
    const excluded = eligible
      .map((session) => ({ file: session.file, reasons: integrityFailures(session) }))
      .filter((entry) => entry.reasons.length > 0);
    const valid = eligible.filter((session) => integrityFailures(session).length === 0);
    const measured = valid.slice(warmups);
    if (measured.length < minRuns) {
      if (excluded.some((entry) => entry.reasons.includes("dev profile session is not benchmark-grade"))) {
        throw new Error(`arm ${arm} contains dev profile evidence; benchmark comparison requires non-dev sessions`);
      }
      throw new Error(`arm ${arm} has ${measured.length} measured runs; ${minRuns} required after warm-up`);
    }
    loaded[arm] = {
      ...summarize(measured),
      filteredNonNominal: sessions.length - eligible.length,
      excludedRuns: excluded,
    };
    allMeasured.push(...measured);
    if (measured.some((session) => !session.binaryHash)) throw new Error(`arm ${arm} has a run without binary hash`);
    if (measured.some((session) => !session.scenarioHash)) throw new Error(`arm ${arm} has a run without scenario hash`);
    if (measured.some((session) => !session.instrumentationPatchHash)) throw new Error(`arm ${arm} has a run without instrumentation hash`);
    if (measured.some((session) => !session.ffmpegCallbackVerified)) throw new Error(`arm ${arm} lacks a verified FFmpeg callback positive control`);
    if (measured.some((session) => !session.mediaHash || !session.projectHash)) throw new Error(`arm ${arm} has a run without media/project hashes`);
    if (measured.some((session) => !session.effectiveDecodePolicy)) throw new Error(`arm ${arm} has a run without effective decode policy`);
    const scenarioHashes = new Set(measured.map((session) => session.scenarioHash));
    if (scenarioHashes.size > 1) throw new Error(`arm ${arm} mixes scenario hashes`);
    const patchHashes = new Set(measured.map((session) => session.instrumentationPatchHash));
    if (patchHashes.size > 1) throw new Error(`arm ${arm} mixes instrumentation patch hashes`);
    const effectivePolicies = new Set(measured.map((session) => session.effectiveDecodePolicy));
    if (effectivePolicies.size > 1) throw new Error(`arm ${arm} mixes effective decode policies`);
  }
  const scenarioHashes = new Set(allMeasured.map((session) => session.scenarioHash));
  if (scenarioHashes.size > 1) throw new Error("A/B arms mix scenario hashes");
  const patchHashes = new Set(allMeasured.map((session) => session.instrumentationPatchHash));
  if (patchHashes.size !== 1) throw new Error("A/B arms require one identical instrumentation hash");
  const mediaHashes = new Set(allMeasured.map((session) => session.mediaHash));
  if (mediaHashes.size !== 1) throw new Error("A/B arms require one identical media hash");
  const projectHashes = new Set(allMeasured.map((session) => session.projectHash));
  if (projectHashes.size !== 1) throw new Error("A/B arms require one identical project hash");
  const effectivePolicies = new Set(allMeasured.map((session) => session.effectiveDecodePolicy));
  if (effectivePolicies.size !== 1) throw new Error("A/B arms require one identical effective decode policy");
  return {
    decisionRuleId: DECISION_RULE_ID,
    warmups,
    minRuns,
    arms: loaded,
    decision: decision(loaded),
  };
}

async function main(argv = process.argv.slice(2)) {
  const warmups = Number(valueAfter(argv, "--warmups", "1"));
  const minRuns = Number(valueAfter(argv, "--min-runs", "5"));
  const armSpecs = argv.filter((arg) => arg.startsWith("--arm="));
  const arms = Object.fromEntries(armSpecs.map((spec) => {
    const [arm, files] = spec.slice("--arm=".length).split("=", 2);
    return [arm, files.split(",")];
  }));
  if (!arms.A || !arms.B || !arms.C) throw new Error("provide --arm=A=file1,... --arm=B=file1,... --arm=C=file1,...");
  process.stdout.write(`${JSON.stringify(await compareArms({ arms, warmups, minRuns }), null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
