#!/usr/bin/env node
/**
 * Build an evidence artifact for controlled native scrub experiments.
 *
 * This report is intentionally conservative: a session is not called
 * cold-cache, background-disabled, or one of five repeats unless the NDJSON
 * contains explicit machine-readable markers for that condition.
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const logDir = valueAfter(
  "--log-dir",
  resolve(process.env.HOME ?? ".", "Library/Application Support/com.deenminder.clypra/perf_logs"),
);
const output = valueAfter("--output", resolve("test-results", "scrub-experiment-report.json"));
const markdownOutput = valueAfter("--markdown-output", resolve("test-results", "scrub-experiment-report.md"));
const limit = Number(valueAfter("--limit", "20"));

const files = existsSync(logDir)
  ? readdirSync(logDir)
      .filter((file) => file.endsWith(".ndjson.uploaded"))
      .sort()
      .slice(-limit)
  : [];

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1)))];
};

const sessions = [];
for (const file of files) {
  const records = readFileSync(resolve(logDir, file), "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const traces = records
    .filter((record) => record.kind === "playback-trace")
    .map((record) => record.payload ?? {});
  const engine = records.find((record) => record.kind === "engine-telemetry")?.payload ?? {};
  const benchmark = records.find((record) => record.kind === "preview-quality-benchmark")?.payload ?? {};
  const nativeSession = records
    .filter((record) => record.kind === "native-session-telemetry")
    .map((record) => record.payload ?? {})
    .at(-1) ?? null;

  const dispatches = new Map();
  const completions = [];
  const terminalOutcomes = {};
  for (const trace of traces) {
    const operationId = trace.operationId;
    if (!operationId) continue;
    if (trace.event === "native-demand-dispatched") {
      dispatches.set(operationId, trace);
    }
    if (trace.event === "native-demand-presented" || trace.event === "native-demand-terminal" || trace.event === "native-demand-abandoned") {
      const start = dispatches.get(operationId);
      if (start && Number.isFinite(start.timeMs) && Number.isFinite(trace.timeMs)) {
        completions.push({
          direction: start.scrubDirection ?? "unknown",
          latencyMs: trace.timeMs - start.timeMs,
          event: trace.event,
        });
      }
      if (trace.event === "native-demand-terminal") {
        const key = trace.outcome ?? "missing-outcome";
        terminalOutcomes[key] = (terminalOutcomes[key] ?? 0) + 1;
      }
    }
  }

  const byDirection = {};
  for (const item of completions) {
    const bucket = (byDirection[item.direction] ??= []);
    bucket.push(item.latencyMs);
  }
  const directions = Object.fromEntries(
    Object.entries(byDirection).map(([direction, values]) => [direction, {
      count: values.length,
      p50Ms: percentile(values, 50),
      p95Ms: percentile(values, 95),
      rangeMs: values.length ? [Math.min(...values), Math.max(...values)] : null,
    }]),
  );

  const telemetry = records
    .filter((record) => record.kind === "native-session-telemetry")
    .map((record) => record.payload ?? {})
    .at(-1) ?? null;
  const experimentContexts = records.flatMap((record) => {
    const payload = record.payload ?? {};
    return [payload.experimentContext, payload.experiment_context].filter(Boolean);
  });
  const presenterValues = records.flatMap((record) => {
    const payload = record.payload ?? {};
    return [
      payload.presenter,
      payload.presenterMode,
      payload.activePresenter,
      payload.previewContext?.surface,
    ].filter((value) => typeof value === "string");
  });
  const profileHints = records.flatMap((record) => {
    const payload = record.payload ?? {};
    const origin = payload.deviceOrigin ?? payload.media?.deviceOrigin ?? payload.profile?.deviceOrigin;
    return origin ? [origin] : [];
  });
  const experimentContext = experimentContexts.at(-1) ?? null;
  sessions.push({
    file,
    traceCount: traces.length,
    environment: {
      device: engine.machine?.gpu_adapter ?? benchmark.gpuModel ?? "unknown",
      os: engine.machine?.os ?? "unknown",
      osVersionRecorded: engine.machine?.os_version ?? "not-recorded",
      decoder: engine.decoder?.backend ?? "unknown",
      codec: engine.decoder?.codec ?? "unknown",
      decoderHardware: engine.decoder?.is_hardware ?? null,
      presenter: presenterValues[0] ?? "not-recorded",
      presenterEvidence: presenterValues.length ? "explicit telemetry field" : "no presenter field in this session",
      graphicsBackend: engine.machine?.graphics_backend ?? benchmark.graphicsBackend ?? "unknown",
      build: engine.machine?.clypra_build ?? "unknown",
    },
    typedTerminalOutcomeCount: Object.entries(terminalOutcomes)
      .filter(([key]) => key !== "missing-outcome")
      .reduce((sum, [, count]) => sum + count, 0),
    terminalOutcomes,
    directions,
    workloadSnapshots: telemetry?.workloadSnapshots ?? nativeSession?.workloadSnapshots ?? null,
    experimentContexts,
    profileHints: [...new Set(profileHints)],
    explicitExperimentMarkers: {
      experimentId: experimentContext?.experimentId ?? null,
      runId: experimentContext?.runId ?? null,
      cacheCleared: experimentContext?.cacheCleared === true,
      backgroundDecodeDisabled: experimentContext?.backgroundDecodeDisabled === true,
      repeatIndex: records.map((record) => record.payload?.repeatIndex).find((value) => Number.isInteger(value)) ?? null,
    },
  });
}

const hasMarker = (name, expected) => sessions.some((session) => session.explicitExperimentMarkers[name] === expected);
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  source: {
    logDirectory: "OS application-data perf_logs (path omitted from artifact)",
    uploadedSessionFiles: sessions.map((session) => session.file),
  },
  identity: {
    pixelOrSamsung: "The logs record google-pixel for some profiles, but do not record Samsung/Note 10 as a device. Treat Samsung as a user-supplied clip/profile label, not a telemetry-confirmed device identity.",
  },
  requestedMeasurements: {
    coldBackwardVsForward: {
      status: hasMarker("cacheCleared", true) ? "available" : "not-established",
      reason: "No cacheCleared marker and no unvisited-range marker exists in the uploaded sessions.",
    },
    backgroundDisabledScrubP95: {
      status: hasMarker("backgroundDecodeDisabled", true) ? "available" : "not-established",
      reason: "No machine-readable marker proves lookahead, thumbnails, filmstrip, and waveform work were disabled during scrub.",
    },
    fiveRepeats: {
      status: sessions.filter((session) => Number.isInteger(session.explicitExperimentMarkers.repeatIndex)).length >= 5 ? "available" : "not-established",
      reason: "The sessions do not carry repeatIndex markers for a controlled five-run series.",
    },
  },
  sessions,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
mkdirSync(dirname(markdownOutput), { recursive: true });
const measurementRows = Object.entries(report.requestedMeasurements)
  .map(([name, measurement]) => `| ${name} | ${measurement.status} | ${measurement.reason} |`)
  .join("\n");
const environmentRows = sessions
  .map((session) => {
    const environment = session.environment;
    const os = environment.osVersionRecorded === "not-recorded"
      ? environment.os
      : `${environment.os}; \`os_version\` recorded as \`${environment.osVersionRecorded}\``;
    const decoder = environment.decoder === "unknown"
      ? "not recorded"
      : `${environment.decoder} ${environment.codec} (${environment.decoderHardware === true ? "hardware" : environment.decoderHardware === false ? "software" : "hardware/software not recorded"})`;
    return `| ${session.file} | ${environment.device} | ${os} | ${decoder} | ${environment.presenter} |`;
  })
  .join("\n");
const markdown = [
  "# Scrub experiment evidence",
  "",
  `Generated: ${report.generatedAt} (artifact generated from the same session inventory as the JSON report)`,
  "",
  "## Controlled measurements",
  "",
  "| Measurement | Status | Reason |",
  "|---|---|---|",
  measurementRows,
  "",
  "Directional latency from prior uncontrolled artifacts is intentionally not repeated here. The JSON artifact includes the current OS-root session inventory and marks controlled measurements as `not-established` until the new experiment context is present.",
  "",
  "## Per-session environment (recorded fields only)",
  "",
  "| Session | Device | OS (recorded fields) | Decoder | Presenter |",
  "|---|---|---|---|---|",
  environmentRows,
  "",
  "The logs record `google-pixel` in some older profile hints, but do not record Samsung/Note 10 as a device. Treat “Samsung” and “Pixel” as user-supplied clip/profile labels unless a future controlled run records a device identity explicitly. This report intentionally makes no performance conclusion from these uncontrolled sessions.",
  "",
].join("\n");
writeFileSync(markdownOutput, markdown);
console.log(`wrote ${output}`);
console.log(`wrote ${markdownOutput}`);
