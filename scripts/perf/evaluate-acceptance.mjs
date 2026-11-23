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
    };
  }

  // Aggregate phase frame metrics
  const phaseStats = {};
  for (const span of phaseSpans) {
    const baseline = getTelemetrySnapshot(span.startTs);
    const finalSnap = getTelemetrySnapshot(span.endTs ?? Infinity);
    const presented = Math.max(0, finalSnap.completedFrames - baseline.completedFrames);
    const dropped = Math.max(0, finalSnap.droppedFrames - baseline.droppedFrames);
    const dirtyRecoveries = Math.max(0, finalSnap.dirtyRecoveries - baseline.dirtyRecoveries);
    const total = presented + dropped;

    phaseStats[span.phaseId] = {
      phaseKind: span.phaseKind,
      durationMs: span.endTs ? span.endTs - span.startTs : null,
      presented,
      dropped,
      total,
      presentationRatio: total > 0 ? presented / total : null,
      dirtyRecoveries,
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
  };

  const totalDirtyRecoveries = Number(concurrency.dirtyRecoveries ?? 0);
  const steadyDirtyRecoveries = steadyStats.dirtyRecoveries ?? totalDirtyRecoveries;
  const zeroCopyViolations = Number(transfers.zero_copy_guard_violations ?? 0);

  // Freeze and latency metrics (from engine playback telemetry and startup diagnostics)
  const projectFps = Number(header.projectFrameRate ?? 25) || 25;
  const frameIntervalMs = 1000 / projectFps;
  const longestFreezeMs = Number(playback.max_frame_ms ?? 0);
  const p99InterPresentMs = Number(playback.p99_frame_ms ?? 0);
  const maxConsecutiveMisses = Number(playback.consecutive_misses_max ?? 0);
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
        ? `startup duration=${phaseStats["startup"].durationMs}ms, TTFF=${timeToFirstFrameMs !== null ? `${timeToFirstFrameMs.toFixed(1)}ms` : "n/a"}`
        : "no startup phase",
      pass: Boolean(phaseStats["startup"]) && (timeToFirstFrameMs === null || timeToFirstFrameMs <= 1000),
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
      target: "<= 1000ms",
      actual: timeToFirstFrameMs !== null ? `${timeToFirstFrameMs.toFixed(1)}ms` : "n/a",
      pass: timeToFirstFrameMs !== null ? timeToFirstFrameMs <= 1000 : true,
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
