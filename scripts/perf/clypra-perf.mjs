#!/usr/bin/env node

/**
 * Offline provenance linter for Clypra performance sessions.
 *
 * NDJSON remains the source of truth.  This tool deliberately does not infer
 * hardware paths from aggregate counters: missing provenance is reported as an
 * untrusted session instead.
 */

import fs from "node:fs/promises";
import childProcess from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CURRENT_SCHEMA_VERSION = 2;
export const DEFAULT_MIN_FRAME_SAMPLES = 1;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

export function normalizeRecord(record, line) {
  const object = asObject(record);
  if (!object) return { line, error: "record is not an object" };
  const payload = asObject(object.payload) ?? {};
  return {
    line,
    kind: typeof object.kind === "string" ? object.kind : "",
    sessionId: typeof object.sessionId === "string" ? object.sessionId : "",
    timestampEpochMs:
      typeof object.timestampEpochMs === "number"
        ? object.timestampEpochMs
        : null,
    schemaVersion:
      typeof object.schemaVersion === "number" ? object.schemaVersion : 1,
    seq: typeof object.seq === "number" ? object.seq : null,
    scope: typeof object.scope === "string" ? object.scope : null,
    payload,
  };
}

function addError(errors, line, code, message) {
  errors.push({ severity: "error", line, code, message });
}

function addWarning(warnings, line, code, message) {
  warnings.push({ severity: "warning", line, code, message });
}

function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normaliseFormat(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

function formatMatchesFourcc(swFormat, fourcc) {
  const sw = normaliseFormat(swFormat);
  const cv = normaliseFormat(fourcc);
  if (!sw || !cv) return true;
  if (sw === "p010le" || sw === "p010") return cv === "x420" || cv === "xf20";
  if (sw === "nv12") return cv === "420v" || cv === "420f";
  return true;
}

/**
 * Lints parsed records and returns a machine-readable trust verdict.
 * Legacy wrapped files are intentionally accepted but marked untrusted.
 */
export function lintRecords(records, options = {}) {
  const {
    expectedHead = null,
    expectedTree = null,
    requireClean = false,
    minFrameSamples = 0,
  } = options;
  const errors = [];
  const warnings = [];
  const normalized = records.map((record, index) =>
    normalizeRecord(record, index + 1),
  );
  const valid = normalized.filter((record) => !record.error);

  for (const record of normalized) {
    if (record.error) {
      addError(errors, record.line, "invalid-record", record.error);
      continue;
    }
    if (!record.kind) addError(errors, record.line, "missing-kind", "kind is required");
    if (!record.sessionId) {
      addError(errors, record.line, "missing-session-id", "sessionId is required");
    }
    if (record.timestampEpochMs === null) {
      addError(
        errors,
        record.line,
        "missing-timestamp",
        "timestampEpochMs is required",
      );
    }
    if (record.schemaVersion >= CURRENT_SCHEMA_VERSION && record.seq === null) {
      addError(errors, record.line, "missing-sequence", "schema v2 records require seq");
    }
    if (record.schemaVersion >= CURRENT_SCHEMA_VERSION && !record.scope) {
      addError(errors, record.line, "missing-scope", "schema v2 records require scope");
    }
    if (record.schemaVersion > CURRENT_SCHEMA_VERSION) {
      addError(
        errors,
        record.line,
        "unsupported-schema-version",
        `schema version ${record.schemaVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
      );
    }
  }

  const sessionIds = new Set(valid.map((record) => record.sessionId));
  if (sessionIds.size > 1) {
    addError(
      errors,
      0,
      "mixed-sessions",
      `records contain ${sessionIds.size} session IDs`,
    );
  }

  const headers = valid.filter((record) => record.kind === "session-header");
  if (headers.length > 1) {
    addError(errors, headers[1].line, "duplicate-session-header", "session-header must be emitted once");
  }
  const header = headers[0];
  if (header) {
    if (header.seq !== 0) {
      addError(errors, header.line, "invalid-header-sequence", "session-header must have seq 0");
    }
    if (header.payload.sessionId !== undefined && header.payload.sessionId !== header.sessionId) {
      addError(errors, header.line, "header-session-mismatch", "header payload sessionId must match the record");
    }
  }
  if (headers.length === 0) {
    const legacyHeader = valid.find(
      (record) =>
        record.kind === "native-diagnostic" &&
        record.payload.marker === "session-open",
    );
    if (legacyHeader) {
      addWarning(
        warnings,
        legacyHeader.line,
        "legacy-session-header",
        "session uses the pre-v2 native-diagnostic session-open marker",
      );
    } else {
      addError(errors, 0, "missing-session-header", "no session-header record found");
    }
  }

  const build = asObject(header?.payload.build);
  if (expectedHead !== null) {
    const recordedHead = typeof build?.gitCommit === "string" ? build.gitCommit : null;
    if (!recordedHead) {
      addError(errors, header?.line ?? 0, "missing-build-commit", "session header does not record gitCommit");
    } else if (recordedHead !== expectedHead) {
      addError(
        errors,
        header?.line ?? 0,
        "build-commit-mismatch",
        `session build commit ${recordedHead} does not match expected HEAD ${expectedHead}`,
      );
    }
  }
  if (expectedTree !== null) {
    const recordedTree = typeof build?.gitTree === "string" ? build.gitTree : null;
    if (!recordedTree) {
      addError(errors, header?.line ?? 0, "missing-build-tree", "session header does not record gitTree");
    } else if (recordedTree !== expectedTree) {
      addError(
        errors,
        header?.line ?? 0,
        "build-tree-mismatch",
        `session build tree ${recordedTree} does not match expected tree ${expectedTree}`,
      );
    }
  }
  if (requireClean) {
    if (build?.gitDirty === true) {
      addError(errors, header?.line ?? 0, "dirty-build", "session was produced from a dirty source tree");
    }
    if (typeof build?.gitDiffHash === "string" && build.gitDiffHash.length > 0) {
      addError(errors, header?.line ?? 0, "dirty-diff-hash", "clean evidence cannot carry a dirty diff hash");
    }
  }

  const contexts = new Map();
  const declaredStreamFormats = new Map();
  for (const record of valid.filter((item) => item.kind === "preview-context")) {
    const id = record.payload.previewContextId;
    if (!Number.isInteger(id)) {
      addError(errors, record.line, "invalid-preview-context", "previewContextId must be an integer");
      continue;
    }
    contexts.set(id, record.payload);
    const format =
      record.payload.sw_format ??
      record.payload.swFormat ??
      record.payload.output_format ??
      record.payload.outputFormat;
    if (format && Array.isArray(record.payload.streamKeys)) {
      for (const streamKey of record.payload.streamKeys) {
        if (typeof streamKey === "string") declaredStreamFormats.set(streamKey, format);
      }
    }
  }

  for (const record of valid) {
    const streams = record.payload.streams;
    if (Array.isArray(streams)) {
      for (const stream of streams) {
        const streamObject = asObject(stream);
        const streamKey = streamObject?.streamKey ?? streamObject?.stream_key;
        const format =
          streamObject?.sw_format ??
          streamObject?.swFormat ??
          streamObject?.output_format ??
          streamObject?.outputFormat;
        if (typeof streamKey === "string" && typeof format === "string") {
          declaredStreamFormats.set(streamKey, format);
        }
      }
    }
    const streamKey = record.payload.streamKey ?? record.payload.stream_key;
    const decoder = asObject(record.payload.decoder);
    const decoderFormat =
      decoder?.sw_format ??
      decoder?.swFormat ??
      decoder?.output_format ??
      decoder?.outputFormat;
    if (typeof streamKey === "string" && typeof decoderFormat === "string") {
      declaredStreamFormats.set(streamKey, decoderFormat);
    }
  }

  const hasCloseMarker = valid.some(
    (record) =>
      record.kind === "native-diagnostic" &&
      record.payload.marker === "session-close",
  );
  if (!hasCloseMarker) {
    addWarning(
      warnings,
      0,
      "incomplete-session",
      "session-close marker is missing; treating the session as incomplete",
    );
  }

  let previousTimestamp = null;
  let previousSeq = null;
  for (const record of valid) {
    if (
      previousTimestamp !== null &&
      record.timestampEpochMs !== null &&
      record.timestampEpochMs < previousTimestamp
    ) {
      addError(errors, record.line, "timestamp-regression", "timestamps must be monotonic");
    }
    if (record.timestampEpochMs !== null) previousTimestamp = record.timestampEpochMs;
    if (record.seq !== null) {
      if (previousSeq !== null && record.seq <= previousSeq) {
        addError(errors, record.line, "sequence-regression", "seq must increase within a session");
      }
      previousSeq = record.seq;
    }

    const contextId = record.payload.previewContextId;
    if (contextId !== undefined && !contexts.has(contextId)) {
      addError(
        errors,
        record.line,
        "unknown-preview-context",
        `previewContextId ${contextId} is not declared`,
      );
    }
    const streamKey = record.payload.streamKey;
    if (streamKey !== undefined) {
      const context = contextId === undefined ? null : contexts.get(contextId);
      if (!context || !Array.isArray(context.streamKeys) || !context.streamKeys.includes(streamKey)) {
        addError(
          errors,
          record.line,
          "unknown-stream-key",
          `streamKey ${String(streamKey)} is not declared by its preview context`,
        );
      }
    }

    const cvPixelFormat =
      record.payload.cvPixelFormat ??
      record.payload.cv_pixel_format ??
      record.payload.fourcc;
    const declaredFormat =
      typeof streamKey === "string" ? declaredStreamFormats.get(streamKey) : null;
    if (
      declaredFormat &&
      typeof cvPixelFormat === "string" &&
      !formatMatchesFourcc(declaredFormat, cvPixelFormat)
    ) {
      addError(
        errors,
        record.line,
        "stream-format-mismatch",
        `stream ${streamKey} declares ${String(declaredFormat)} but frame reports ${cvPixelFormat}`,
      );
    }
  }

  const engineRecords = valid.filter((record) => record.kind === "engine-telemetry");
  const finalEngine = engineRecords.at(-1);
  const transfers = asObject(finalEngine?.payload.transfers);
  if (transfers) {
    const attempts = asFiniteNumber(transfers.metal_decode_attempts);
    const successes = asFiniteNumber(transfers.metal_decode_successes);
    const failures = asFiniteNumber(transfers.metal_decode_failures);
    if (attempts !== null && successes !== null && failures !== null) {
      const failureReasons = asObject(transfers.metal_decode_failure_reasons);
      const unrecorded =
        asFiniteNumber(transfers.metal_decode_unrecorded) ??
        asFiniteNumber(failureReasons?.unrecorded) ??
        0;
      const inFlightAtClose =
        asFiniteNumber(transfers.metal_decode_in_flight_at_close) ?? 0;
      const accounted = successes + failures + unrecorded + inFlightAtClose;
      if (attempts !== accounted) {
        addError(
          errors,
          finalEngine.line,
          "counter-reconciliation",
          `metal decode attempts (${attempts}) do not equal successes (${successes}) plus failures (${failures}) plus unrecorded (${unrecorded}) plus in-flight-at-close (${inFlightAtClose})`,
        );
      }
      if (unrecorded > 0) {
        addError(
          errors,
          finalEngine.line,
          "unrecorded-decode-outcome",
          `${unrecorded} decode attempt(s) were dropped without a terminal outcome`,
        );
      }
      if (inFlightAtClose > 0) {
        addError(
          errors,
          finalEngine.line,
          "in-flight-decode-at-close",
          `${inFlightAtClose} decode attempt(s) were still in flight at session close`,
        );
      }
    }
    const bySite = asObject(transfers.hwframe_transfer_calls_by_site);
    const playbackTransfers = asFiniteNumber(bySite?.playback) ?? 0;
    if (playbackTransfers > 0) {
      addError(
        errors,
        finalEngine.line,
        "playback-transfer",
        `playback performed ${playbackTransfers} hardware-frame transfer(s); expected exactly zero`,
      );
    }
    const unknownTransfers = asFiniteNumber(bySite?.unknown) ?? 0;
    if (unknownTransfers > 0) {
      addError(
        errors,
        finalEngine.line,
        "unknown-transfer-site",
        `${unknownTransfers} transfer(s) have an unknown call site`,
      );
    }
    const guardViolations =
      asFiniteNumber(transfers.zero_copy_guard_violations) ?? 0;
    if (guardViolations > 0) {
      addError(
        errors,
        finalEngine.line,
        "zero-copy-guard-violation",
        `${guardViolations} zero-copy guard violation(s) were recorded by the engine`,
      );
    }
  }

  const emittedGuardViolations = valid.filter(
    (record) => record.kind === "zero-copy-violation",
  ).length;
  if (emittedGuardViolations > 0) {
    addError(
      errors,
      0,
      "zero-copy-guard-violation",
      `${emittedGuardViolations} zero-copy guard violation record(s) were emitted`,
    );
  }

  const frameSampleKinds = new Set([
    "frame",
    "native-frame",
    "performance-sample",
    "engine-frame-telemetry",
  ]);
  const frameSampleCount = valid.filter((record) => frameSampleKinds.has(record.kind)).length;
  if (frameSampleCount < minFrameSamples) {
    addError(
      errors,
      0,
      "insufficient-frame-samples",
      `session contains ${frameSampleCount} frame sample(s); at least ${minFrameSamples} required`,
    );
  }

  const evidenceGrade =
    headers.length > 0 && errors.length === 0 && hasCloseMarker
      ? "measured"
      : "untrusted";
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    evidenceGrade,
    trusted: evidenceGrade === "measured",
    recordCount: valid.length,
    frameSampleCount,
    sessionIds: [...sessionIds],
    declaredPreviewContexts: contexts.size,
    completionStatus: hasCloseMarker ? "complete" : "incomplete",
    errors,
    warnings,
  };
}

export async function readNdjson(filePath, options = {}) {
  const raw = await fs.readFile(filePath, "utf8");
  const records = [];
  const parseErrors = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      parseErrors.push({
        severity: "error",
        line: index + 1,
        code: "invalid-json",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  const report = lintRecords(records, options);
  report.errors.unshift(...parseErrors);
  if (parseErrors.length > 0) {
    report.trusted = false;
    report.evidenceGrade = "untrusted";
  }
  return report;
}

function renderMarkdown(report, filePath) {
  const lines = [
    `# Clypra performance lint`,
    ``,
    `- File: \`${filePath}\``,
    `- Evidence grade: **${report.evidenceGrade}**`,
    `- Completion: **${report.completionStatus}**`,
    `- Records: ${report.recordCount}`,
    `- Frame samples: ${report.frameSampleCount}`,
    `- Preview contexts: ${report.declaredPreviewContexts}`,
    `- Errors: ${report.errors.length}`,
    `- Warnings: ${report.warnings.length}`,
  ];
  for (const issue of [...report.errors, ...report.warnings]) {
    lines.push(`- ${issue.severity}: **${issue.code}** — ${issue.message}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main(argv) {
  const [command, filePath, ...flags] = argv;
  if (command !== "lint" || !filePath) {
    console.error(
      "Usage: clypra-perf.mjs lint <session.ndjson> [--json] [--expect-head] [--require-clean] [--min-frame-samples N]",
    );
    return 2;
  }
  const options = {
    requireClean: flags.includes("--require-clean"),
    minFrameSamples: DEFAULT_MIN_FRAME_SAMPLES,
  };
  if (flags.includes("--min-frame-samples")) {
    const index = flags.indexOf("--min-frame-samples");
    const value = Number(flags[index + 1]);
    if (!Number.isInteger(value) || value < 0) {
      console.error("--min-frame-samples requires a non-negative integer");
      return 2;
    }
    options.minFrameSamples = value;
  }
  if (flags.includes("--expect-head") || options.requireClean) {
    try {
      options.expectedHead = childProcess
        .execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
        .trim();
      options.expectedTree = childProcess
        .execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" })
        .trim();
    } catch (error) {
      console.error(
        `Unable to resolve repository HEAD: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 2;
    }
  }
  if (options.requireClean) {
    const status = childProcess
      .execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
      .trim();
    if (status) {
      console.error("--require-clean failed: the current source tree has uncommitted changes");
      return 1;
    }
  }
  const report = await readNdjson(path.resolve(filePath), options);
  if (flags.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderMarkdown(report, filePath));
  }
  return report.trusted ? 0 : 1;
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exitCode = code)
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 2;
    });
}
