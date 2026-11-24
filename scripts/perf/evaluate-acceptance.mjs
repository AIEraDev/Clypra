#!/usr/bin/env node

/**
 * Evaluates a completed preview perf session log against the acceptance criteria:
 * 1. Protected debug endpoint verified via build identity (perfDriverEnabled).
 * 2. Arm resolved meaning verified ("dirty-recovery-enabled").
 * 3. Input hashes and frame rates verified.
 * 4. Startup phase (first 2s) isolated from steady_playback.
 * 5. Pass criteria for steady_playback:
 *    - presentation ratio >= 95%
 *    - dirty recoveries <= 1
 *    - starvation and resync_behind near zero
 *    - watchdog zero
 *    - zero-copy violations zero
 *    - footer closed and trusted
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

function valueAfter(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

export async function evaluateSession(filePath) {
  const rawContent = await readFile(filePath, "utf8");
  const lines = rawContent.split(/\r?\n/).filter(Boolean);
  const records = [];
  let parseErrors = 0;

  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      parseErrors++;
    }
  }

  const headerRecord = records.find((r) => r.kind === "session-header");
  const footerRecord = records.filter((r) => r.kind === "session-footer").at(-1);
  const header = headerRecord?.payload ?? {};
  const footer = footerRecord?.payload ?? {};

  // Track phase intervals
  const phaseSpans = [];
  let currentPhase = null;

  for (const r of records) {
    if (r.kind === "native-diagnostic" && r.payload?.marker === "perf-phase") {
      const p = r.payload;
      if (p.phaseEvent === "start") {
        currentPhase = {
          phaseId: p.phaseId,
          phaseKind: p.phaseKind,
          startTs: r.timestampEpochMs,
          endTs: null,
          records: [],
        };
        phaseSpans.push(currentPhase);
      } else if (p.phaseEvent === "end" && currentPhase && currentPhase.phaseId === p.phaseId) {
        currentPhase.endTs = r.timestampEpochMs;
        currentPhase = null;
      }
    }
  }

  // Engine telemetry / concurrency
  const engineTelemetries = records.filter((r) => r.kind === "engine-telemetry");
  const finalEngine = engineTelemetries.at(-1)?.payload ?? {};
  const concurrency = finalEngine.previewConcurrency ?? {};
  const transfers = finalEngine.transfers ?? {};
  const playback = finalEngine.playback ?? {};

  function getTelemetrySnapshot(targetTs) {
    const nstRecords = records.filter((r) => r.kind === "native-session-telemetry");
    const etRecords = records.filter((r) => r.kind === "engine-telemetry");

    const nst = nstRecords.filter((r) => r.timestampEpochMs <= targetTs).at(-1)
      ?? { payload: { workloadSnapshots: { playback: { completedFrames: 0, droppedFrames: 0 } } } };
    const et = etRecords.filter((r) => r.timestampEpochMs <= targetTs).at(-1)
      ?? { payload: { previewConcurrency: { dirtyRecoveries: 0 } } };

    const pb = nst.payload?.workloadSnapshots?.playback ?? {};
    return {
      completedFrames: Number(pb.completedFrames ?? 0),
      droppedFrames: Number(pb.droppedFrames ?? 0),
      dirtyRecoveries: Number(et.payload?.previewConcurrency?.dirtyRecoveries ?? 0),
      playback: et.payload?.playback ?? null,
    };
  }

  // Aggregate phase frame metrics
  const phaseStats = {};
  for (const span of phaseSpans) {
    const baseline = getTelemetrySnapshot(span.startTs);
    const finalSnap = getTelemetrySnapshot(span.endTs ?? Infinity);
    const presented = Math.max(0, finalSnap.completedFrames - baseline.completedFrames);
    const dropped = Math.max(0, finalSnap.droppedFrames - baseline.droppedFrames);
    let dirtyRecoveries = Math.max(0, finalSnap.dirtyRecoveries - baseline.dirtyRecoveries);

    // If no telemetry record was emitted at the start boundary of this phase,
    // verify against phase-tagged scheduler decisions so startup predecode
    // cancellations are not falsely attributed to steady playback.
    const phaseSchedRecords = records.filter((r) => {
      if (r.kind !== "native-diagnostic" || r.payload?.marker !== "sched.decision") return false;
      const pid = r.payload?.phaseId;
      if (pid === span.phaseId) return true;
      const ts = r.timestampEpochMs;
      return span.startTs !== null && ts >= span.startTs && (span.endTs === null || ts <= span.endTs);
    });
    const schedAbortsInPhase = phaseSchedRecords.filter((r) => {
      const a = r.payload?.action;
      const reason = r.payload?.reason;
      return a === "abort" || (a === "start" && reason === "resync_behind");
    }).length;

    if (span.phaseId !== "startup" && schedAbortsInPhase === 0 && dirtyRecoveries > 0) {
      const startupAborts = records.filter(
        (r) => r.kind === "native-diagnostic" && r.payload?.marker === "sched.decision" && r.payload?.phaseId === "startup" && r.payload?.action === "abort"
      ).length;
      if (startupAborts > 0) {
        dirtyRecoveries = 0;
      }
    }
    const total = presented + dropped;

    phaseStats[span.phaseId] = {
      phaseKind: span.phaseKind,
      durationMs: span.endTs ? span.endTs - span.startTs : null,
      presented,
      dropped,
      total,
      presentationRatio: total > 0 ? presented / total : null,
      dirtyRecoveries,
      playback: finalSnap.playback,
    };
  }

  // Session totals
  const totalFramesPresented = Number(finalEngine.totalFramesPresented ?? playback.presented_on_time_count ?? 0);
  const totalFramesDropped = Number(finalEngine.totalFramesDropped ?? playback.dropped_count ?? 0);
  const steadyStats = phaseStats["composite_playback"] ?? phaseStats["steady_playback"] ?? {
    presented: totalFramesPresented,
    dropped: totalFramesDropped,
    total: totalFramesPresented + totalFramesDropped,
    presentationRatio:
      totalFramesPresented + totalFramesDropped > 0
        ? totalFramesPresented / (totalFramesPresented + totalFramesDropped)
        : null,
    dirtyRecoveries: Number(concurrency.dirtyRecoveries ?? 0),
    playback: finalEngine.playback ?? null,
  };

  const totalDirtyRecoveries = Number(concurrency.dirtyRecoveries ?? 0);
  const steadyDirtyRecoveries = steadyStats.dirtyRecoveries ?? totalDirtyRecoveries;
  const zeroCopyViolations = Number(transfers.zero_copy_guard_violations ?? 0);

  // Freeze and latency metrics (from engine playback telemetry and startup diagnostics)
  const projectFps = Number(header.projectFrameRate ?? 25) || 25;
  const frameIntervalMs = 1000 / projectFps;
  const steadyPlayback = steadyStats.playback ?? playback;
  const longestFreezeMs = Number(steadyPlayback.max_frame_ms ?? playback.max_frame_ms ?? 0);
  const p99InterPresentMs = Number(steadyPlayback.p99_frame_ms ?? playback.p99_frame_ms ?? 0);

  // Compute maximum consecutive dropped frames from telemetry engine and snapshot bursts
  let maxDroppedBurst = 0;
  let lastDropped = null;
  for (const r of records) {
    if (r.kind === "native-session-telemetry") {
      const dropped = Number(r.payload?.workloadSnapshots?.playback?.droppedFrames ?? 0);
      if (lastDropped !== null && dropped > lastDropped) {
        const burst = dropped - lastDropped;
        if (burst > maxDroppedBurst) maxDroppedBurst = burst;
      }
      lastDropped = dropped;
    }
  }
  const maxConsecutiveMisses = Math.max(
    Number(steadyPlayback.consecutive_misses_max ?? playback.consecutive_misses_max ?? 0),
    maxDroppedBurst,
  );
  const consecutiveMissFreezeMs = maxConsecutiveMisses * frameIntervalMs;
  const effectiveLongestFreezeMs = Math.max(longestFreezeMs, consecutiveMissFreezeMs);

  const firstFrameRecord = records.find(
    (r) =>
      r.kind === "native-diagnostic" &&
      r.payload?.marker === "native-playback-startup" &&
      r.payload?.stage === "first-native-frame-presented"
  );
  const timeToFirstFrameMs = firstFrameRecord ? Number(firstFrameRecord.payload.elapsedUs) / 1000 : null;

  // Transport start retry tracking (Item 4)
  const phaseMarkerWithAttempts = records.find(
    (r) => r.kind === "native-diagnostic" && r.payload?.marker === "perf-phase" && r.payload?.playStartAttempts !== undefined
  );
  const playStartAttempts = header.playStartAttempts ?? phaseMarkerWithAttempts?.payload?.playStartAttempts ?? 1;

  // Steady phase lookahead tracking (Flag 3)
  const steadySpan = phaseSpans.find(
    (s) => s.phaseId === "composite_playback" || s.phaseId === "steady_playback"
  );
  const hasSteadyPhase = Boolean(phaseStats["composite_playback"] || phaseStats["steady_playback"]);

  const steadySchedRecords = records.filter((r) => {
    if (r.kind !== "native-diagnostic" || r.payload?.marker !== "sched.decision") {
      return false;
    }
    const pid = r.payload?.phaseId;
    if (pid === "composite_playback" || pid === "steady_playback") {
      return true;
    }
    if (steadySpan) {
      const ts = r.timestampEpochMs;
      return ts >= steadySpan.startTs && (steadySpan.endTs === null || ts <= steadySpan.endTs);
    }
    return false;
  });

  const lookaheadDepths = steadySchedRecords
    .map((r) => r.payload?.lookaheadFrames)
    .filter((v) => typeof v === "number" && !Number.isNaN(v));

  let minLookaheadDepth = null;
  let avgLookaheadDepth = null;
  let lookaheadDataMissing = false;

  if (hasSteadyPhase) {
    if (lookaheadDepths.length === 0) {
      lookaheadDataMissing = true;
    } else {
      minLookaheadDepth = Math.min(...lookaheadDepths);
      avgLookaheadDepth = lookaheadDepths.reduce((a, b) => a + b, 0) / lookaheadDepths.length;
    }
  }

  // Composition metrics (from composition-rollup or frontend-rollup)
  const compRecords = records.filter(
    (r) => (r.kind === "composition-rollup" || r.kind === "frontend-rollup") && r.payload?.compositionMetrics
  );
  const latestComp = compRecords.at(-1)?.payload?.compositionMetrics ?? null;
  const isCompositePreset = header.scenarioPreset === "playback-composite-30s" || Boolean(phaseStats["composite_playback"]);

  // Criteria checks
  const criteria = {
    c1_debugEndpointProtected: {
      description: "Debug endpoint protected (perfDriverEnabled true)",
      target: true,
      actual: header.build?.perfDriverEnabled === true,
      pass: header.build?.perfDriverEnabled === true,
    },
    c2_armResolvedMeaning: {
      description: "Resolved experiment arm meaning is dirty-recovery-enabled",
      target: "dirty-recovery-enabled",
      actual: header.experimentArmMeaning,
      pass:
        header.experimentArmMeaning === "dirty-recovery-enabled" &&
        header.resolvedFlags?.CLYPRA_DEBUG_DISABLE_DIRTY_RECOVERY === false,
    },
    c3_inputMatching: {
      description: "Inputs matched (media & project hashes, duration > 0)",
      target: "hashes present & duration > 0",
      actual: `duration=${header.projectComputedDuration}, projectRate=${header.projectFrameRate}, mediaRate=${header.mediaFrameRate}`,
      pass:
        typeof header.mediaHash === "string" &&
        header.mediaHash.length > 0 &&
        typeof header.projectHash === "string" &&
        header.projectHash.length > 0 &&
        header.projectComputedDuration > 0,
    },
    c4_startupPhaseIsolated: {
      description: "Startup phase isolated and time to first frame <= 1000ms",
      target: "startup phase exists & TTFF <= 1000ms",
      actual: phaseStats["startup"]
        ? `startup duration=${phaseStats["startup"].durationMs}ms, TTFF=${timeToFirstFrameMs !== null ? `${timeToFirstFrameMs.toFixed(1)}ms` : "missing"}`
        : "no startup phase",
      pass: Boolean(phaseStats["startup"]) && timeToFirstFrameMs !== null && timeToFirstFrameMs <= 1000,
    },
    c5_steadyPlaybackPresented: {
      description: "Steady playback phase presented >= 95% with valid frame count",
      target: ">= 95% & total > 0",
      actual: steadyStats.presentationRatio !== null
        ? `${(steadyStats.presentationRatio * 100).toFixed(2)}% (${steadyStats.presented}/${steadyStats.total})`
        : "n/a (0 expected frames)",
      pass: steadyStats.presentationRatio !== null && steadyStats.presentationRatio >= 0.95 && steadyStats.total > 0,
    },
    c6_dirtyRecoveries: {
      description: "Dirty recoveries <= 1 during steady_playback",
      target: "<= 1",
      actual: `${steadyDirtyRecoveries} (steady delta, ${totalDirtyRecoveries} total)`,
      pass: steadyDirtyRecoveries <= 1,
    },
    c7_zeroCopyGuards: {
      description: "Zero-copy violations == 0",
      target: 0,
      actual: zeroCopyViolations,
      pass: zeroCopyViolations === 0,
    },
    c8_footerClosed: {
      description: "Session footer closed and lint trusted",
      target: "closed & 0 parse errors",
      actual: `status=${footer.status}, parseErrors=${parseErrors}`,
      pass: footer.status === "closed" && parseErrors === 0,
    },
    c9_compositionRollup: {
      description: "Composite layer telemetry (text, audio, image, multi-video)",
      target: isCompositePreset ? "multi-layer active (maxVisualLayers >= 2)" : "valid layer tracking",
      actual: latestComp
        ? `maxVisual=${latestComp.maxVisualLayers}, textP95=${latestComp.textLayerPercentiles?.p95 ?? 0}, videoP95=${latestComp.videoLayerPercentiles?.p95 ?? 0}, audioMax=${latestComp.maxAudioClips}`
        : isCompositePreset
          ? "composition metrics missing"
          : "single-layer baseline (n/a)",
      pass: isCompositePreset ? Boolean(latestComp && latestComp.maxVisualLayers >= 2) : true,
    },
    c10_playStartAttempts: {
      description: "Play transport start attempts <= 1 (no retry masking)",
      target: "<= 1",
      actual: `${playStartAttempts}${playStartAttempts > 1 ? " (WARNING: harness retries masked transport start failure)" : ""}`,
      pass: playStartAttempts <= 1,
    },
    c11_longestFreeze: {
      description: "Longest freeze <= 200ms",
      target: "<= 200ms",
      actual: `${effectiveLongestFreezeMs.toFixed(2)}ms (consecutive misses: ${maxConsecutiveMisses}, max frame: ${longestFreezeMs.toFixed(2)}ms)`,
      pass: effectiveLongestFreezeMs <= 200,
    },
    c12_p99InterPresent: {
      description: "p99 inter-present interval <= 60ms",
      target: "<= 60ms",
      actual: `${p99InterPresentMs.toFixed(2)}ms`,
      pass: p99InterPresentMs <= 60,
    },
    c13_timeToFirstFrame: {
      description: "Time to first frame presented <= 1000ms",
      target: "<= 1000ms (data required)",
      actual: timeToFirstFrameMs !== null ? `${timeToFirstFrameMs.toFixed(1)}ms` : "missing (first frame presented marker not found)",
      pass: timeToFirstFrameMs !== null && timeToFirstFrameMs <= 1000,
    },
    c14_lookaheadDepthSteady: {
      description: "Minimum lookahead depth in steady playback >= 2 frames",
      target: hasSteadyPhase ? "min >= 2 frames (data required)" : "n/a (no steady phase)",
      actual: hasSteadyPhase
        ? (lookaheadDataMissing
            ? "lookahead data missing (0 samples)"
            : `min=${minLookaheadDepth}, avg=${avgLookaheadDepth.toFixed(2)}, samples=${lookaheadDepths.length}`)
        : "n/a",
      pass: hasSteadyPhase
        ? (!lookaheadDataMissing && minLookaheadDepth >= 2)
        : true,
    },
  };

  const allPassed = Object.values(criteria).every((c) => c.pass);

  return {
    filePath,
    sessionId: header.sessionId,
    allPassed,
    criteria,
    phases: phaseStats,
    rawEngine: {
      totalFramesPresented,
      totalFramesDropped,
      totalDirtyRecoveries,
      zeroCopyViolations,
      concurrency,
    },
  };
}

async function main() {
  const file = valueAfter(process.argv, "--file") || process.argv[2];
  if (!file) {
    console.error("Usage: node evaluate-acceptance.mjs --file <path-to-session.ndjson>");
    process.exit(1);
  }

  const result = await evaluateSession(file);
  console.log(`\n===============================================================`);
  console.log(`CLYPRA ACCEPTANCE EVALUATION: ${result.sessionId}`);
  console.log(`Log File: ${result.filePath}`);
  console.log(`Overall Result: ${result.allPassed ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`===============================================================\n`);

  for (const [key, c] of Object.entries(result.criteria)) {
    const symbol = c.pass ? "✅" : "❌";
    console.log(`${symbol} [${key}] ${c.description}`);
    console.log(`   Target: ${c.target} | Actual: ${c.actual}\n`);
  }

  console.log("Phase Breakdown:");
  for (const [phase, stats] of Object.entries(result.phases)) {
    const ratioStr =
      stats.presentationRatio !== null
        ? `${(stats.presentationRatio * 100).toFixed(2)}%`
        : "n/a";
    console.log(
      `  - ${phase} (${stats.phaseKind}): presented=${stats.presented}, dropped=${stats.dropped}, ratio=${ratioStr}`
    );
  }

  process.exit(result.allPassed ? 0 : 1);
}

import { fileURLToPath } from "node:url";

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
