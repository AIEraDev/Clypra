#!/usr/bin/env node

/**
 * Clypra Local Forensic Reporter: Timeline Zoom, Ruler & Frame Cell
 *
 * Reads append-only NDJSON session logs from the OS app-data perf_logs directory
 * (never inside the repository), filters for "timeline-zoom-rollup" and related entries,
 * redacts personal paths, and prints evidence-labeled performance analytics:
 *   - Frame times (p50 / p95 / max / drops)
 *   - Settle durations (p50 / p95 / timeouts)
 *   - Wheel delta distribution & discrete step traversal histogram
 *   - Cadence distribution vs reference parity table
 *   - Frame cell update costs (µs) & preview parity mismatches
 *   - 32M px WebKit layout cap engagements & peak width
 *   - Invariant counters (must be strictly 0)
 *   - Evidence labels (Observed / Derived / Hypothesis / Confirmed Cause / Not measured)
 *
 * Usage:
 *   node scripts/perf/report-timeline-zoom.mjs [optional-path-to-ndjson-or-dir]
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Path Resolution & Redaction ───────────────────────────────────────────────

function redactPath(rawPath) {
  if (typeof rawPath !== "string") return rawPath;
  return rawPath
    .replace(/\/Users\/[^/\\]+/g, "/Users/[REDACTED]")
    .replace(/[A-Z]:\\Users\\[^\\]+/gi, "C:\\Users\\[REDACTED]");
}

function resolvePerfLogsDir() {
  const platform = os.platform();
  const home = os.homedir();

  if (platform === "darwin") {
    const primary = path.join(home, "Library/Application Support/com.deenminder.clypra/perf_logs");
    if (fs.existsSync(primary)) return primary;
    const fallback = path.join(home, "Library/Application Support/com.clypra.app/perf_logs");
    if (fs.existsSync(fallback)) return fallback;
    return primary;
  } else if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData/Roaming");
    const primary = path.join(appData, "com.deenminder.clypra", "perf_logs");
    if (fs.existsSync(primary)) return primary;
    const fallback = path.join(appData, "com.clypra.app", "perf_logs");
    if (fs.existsSync(fallback)) return fallback;
    return primary;
  } else {
    const dataHome = process.env.XDG_DATA_HOME || path.join(home, ".local/share");
    return path.join(dataHome, "com.deenminder.clypra", "perf_logs");
  }
}

// ── Metric Accumulator ───────────────────────────────────────────────────────

class ZoomTelemetryAggregator {
  constructor() {
    this.totalRollups = 0;
    this.totalGestures = 0;
    this.totalInputEvents = 0;
    this.anomalies = 0;

    this.frameMsP50Samples = [];
    this.frameMsP95Samples = [];
    this.frameMsMax = 0;
    this.framesOver16 = 0;
    this.framesOver33 = 0;
    this.framesOver100 = 0;

    this.settleP50Samples = [];
    this.settleP95Samples = [];
    this.settleMax = 0;
    this.settleTimeouts = 0;

    this.wheelBuckets = {
      lt_5: 0,
      b5_15: 0,
      b15_50: 0,
      b50_120: 0,
      gt_120: 0,
    };

    this.inputKinds = {};
    this.cadenceHistogram = {};

    this.rulerSampleCount = 0;
    this.rulerCapHits = 0;
    this.rulerAvgMsSamples = [];
    this.rulerP95MsSamples = [];

    this.frameCellSampleCount = 0;
    this.frameCellMismatches = 0;
    this.frameCellAvgUsSamples = [];
    this.frameCellP95UsSamples = [];

    this.layoutCapEngaged = 0;
    this.layoutCapPeakPx = 0;

    this.invariants = {
      zoom_out_raised_pps: 0,
      pps_out_of_bounds: 0,
      anchor_drift_gt_1px: 0,
      conflicting_max_pps: 0,
    };

    this.filmstripSettleSamples = [];
  }

  ingestEntry(entry) {
    if (entry.kind === "filmstrip-rollup" && entry.payload) {
      if (typeof entry.payload.avgZoomTimeToVisibleMs === "number" && entry.payload.avgZoomTimeToVisibleMs > 0) {
        this.filmstripSettleSamples.push(entry.payload.avgZoomTimeToVisibleMs);
      }
      return;
    }

    if (entry.kind !== "timeline-zoom-rollup" || !entry.payload) return;
    const p = entry.payload;

    this.totalRollups++;
    if (p.anomaly) this.anomalies++;

    if (p.gestures) {
      this.totalGestures += p.gestures.count || 0;
      if (p.gestures.by_input) {
        for (const [k, v] of Object.entries(p.gestures.by_input)) {
          this.inputKinds[k] = (this.inputKinds[k] || 0) + v;
        }
      }
    }

    if (p.frame_ms) {
      if (p.frame_ms.p50 > 0) this.frameMsP50Samples.push(p.frame_ms.p50);
      if (p.frame_ms.p95 > 0) this.frameMsP95Samples.push(p.frame_ms.p95);
      if (p.frame_ms.max > this.frameMsMax) this.frameMsMax = p.frame_ms.max;
      this.framesOver16 += p.frame_ms.over_16 || 0;
      this.framesOver33 += p.frame_ms.over_33 || 0;
      this.framesOver100 += p.frame_ms.over_100 || 0;
    }

    if (p.settle_ms) {
      if (p.settle_ms.p50 > 0) this.settleP50Samples.push(p.settle_ms.p50);
      if (p.settle_ms.p95 > 0) this.settleP95Samples.push(p.settle_ms.p95);
      this.settleTimeouts += p.settle_ms.timeouts || 0;
    }

    if (p.wheel && Array.isArray(p.wheel.delta_y_buckets)) {
      this.wheelBuckets.lt_5 += p.wheel.delta_y_buckets[0] || 0;
      this.wheelBuckets.b5_15 += p.wheel.delta_y_buckets[1] || 0;
      this.wheelBuckets.b15_50 += p.wheel.delta_y_buckets[2] || 0;
      this.wheelBuckets.b50_120 += p.wheel.delta_y_buckets[3] || 0;
      this.wheelBuckets.gt_120 += p.wheel.delta_y_buckets[4] || 0;
    }

    if (p.ruler) {
      this.rulerCapHits += p.ruler.cap_hits || 0;
      if (p.ruler.gen_ms_p95 > 0) this.rulerP95MsSamples.push(p.ruler.gen_ms_p95);
      if (p.ruler.cadence_hist) {
        for (const [k, v] of Object.entries(p.ruler.cadence_hist)) {
          this.cadenceHistogram[k] = (this.cadenceHistogram[k] || 0) + v;
        }
      }
    }

    if (p.frame_cell) {
      this.frameCellMismatches += p.frame_cell.mismatches || 0;
      if (p.frame_cell.update_us_p95 > 0) this.frameCellP95UsSamples.push(p.frame_cell.update_us_p95);
    }

    if (p.layout_cap) {
      this.layoutCapEngaged += p.layout_cap.engaged || 0;
      if ((p.layout_cap.peak_px || 0) > this.layoutCapPeakPx) {
        this.layoutCapPeakPx = p.layout_cap.peak_px;
      }
    }

    if (p.invariants) {
      this.invariants.zoom_out_raised_pps += p.invariants.zoom_out_raised_pps || 0;
      this.invariants.pps_out_of_bounds += p.invariants.pps_out_of_bounds || 0;
      this.invariants.anchor_drift_gt_1px += p.invariants.anchor_drift_gt_1px || 0;
      this.invariants.conflicting_max_pps += p.invariants.conflicting_max_pps || 0;
    }
  }

  average(arr) {
    if (!arr.length) return 0;
    const sum = arr.reduce((acc, val) => acc + val, 0);
    return Math.round((sum / arr.length) * 100) / 100;
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

function main() {
  const targetArg = process.argv[2];
  const logsPath = targetArg ? path.resolve(targetArg) : resolvePerfLogsDir();

  console.log("================================================================================");
  console.log("CLYPRA TIMELINE ZOOM, RULER & FRAME CELL TELEMETRY REPORT");
  console.log("================================================================================");
  console.log(`Log Source Path: ${redactPath(logsPath)}`);

  if (!fs.existsSync(logsPath)) {
    console.log("\n[Notice] No perf_logs directory or file found at target location.");
    console.log("Evidence Label: [Observed] Zero NDJSON files on host system.");
    return;
  }

  let filesToProcess = [];
  const stat = fs.statSync(logsPath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(logsPath);
    filesToProcess = entries
      .filter((f) => f.endsWith(".ndjson"))
      .map((f) => path.join(logsPath, f));
  } else if (stat.isFile()) {
    filesToProcess = [logsPath];
  }

  if (filesToProcess.length === 0) {
    console.log("\n[Notice] No .ndjson files found to process.");
    console.log("Evidence Label: [Observed] Directory empty.");
    return;
  }

  console.log(`Processing ${filesToProcess.length} session file(s)...\n`);

  const agg = new ZoomTelemetryAggregator();

  for (const filePath of filesToProcess) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed);
          agg.ingestEntry(entry);
        } catch {
          // malformed line ignore
        }
      }
    } catch (err) {
      console.warn(`Could not read ${redactPath(filePath)}:`, err.message);
    }
  }

  console.log("--------------------------------------------------------------------------------");
  console.log("1. SESSION ROLLUP & GESTURE ACTIVITY");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Total Zoom Rollup Windows:  ${agg.totalRollups}`);
  console.log(`Total Zoom Gestures:        ${agg.totalGestures}`);
  console.log(`Total Input Events:         ${agg.totalInputEvents}`);
  console.log(`Flagged Anomalies:          ${agg.anomalies}`);
  console.log("Input Kinds Distribution:  ", JSON.stringify(agg.inputKinds, null, 2));
  console.log("Evidence Label: [Observed]");

  console.log("\n--------------------------------------------------------------------------------");
  console.log("2. FRAME PACING & SETTLE DURATION (Spring / Inertia)");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Frame Time p50 (avg of windows): ${agg.average(agg.frameMsP50Samples)} ms`);
  console.log(`Frame Time p95 (avg of windows): ${agg.average(agg.frameMsP95Samples)} ms (Budget: ≤ 16.7 ms)`);
  console.log(`Frame Time Max Observed:        ${agg.frameMsMax.toFixed(2)} ms (Budget: ≤ 100 ms)`);
  console.log(`Frames > 16.7 ms:               ${agg.framesOver16}`);
  console.log(`Frames > 33.3 ms (Dropped):     ${agg.framesOver33}`);
  console.log(`Frames > 100.0 ms (Stall):      ${agg.framesOver100}`);
  console.log(`Settle Duration p50:            ${agg.average(agg.settleP50Samples)} ms`);
  console.log(`Settle Duration p95:            ${agg.average(agg.settleP95Samples)} ms (Budget: ≤ 250 ms)`);
  console.log(`Settle Timeouts (>2000ms):      ${agg.settleTimeouts}`);
  if (agg.filmstripSettleSamples.length > 0) {
    console.log(`Filmstrip Settle Avg:           ${agg.average(agg.filmstripSettleSamples)} ms (Budget: ≤ 150 ms)`);
  } else {
    console.log("Filmstrip Settle Avg:           Not measured (no filmstrip tiles requested during zoom)");
  }
  console.log("Evidence Label: [Observed / Derived percentiles]");

  console.log("\n--------------------------------------------------------------------------------");
  console.log("3. WHEEL DELTA DISTRIBUTION (Fixed Buckets)");
  console.log("--------------------------------------------------------------------------------");
  console.log(`DeltaY < 5 px:                  ${agg.wheelBuckets.lt_5}`);
  console.log(`DeltaY 5 - 15 px:               ${agg.wheelBuckets.b5_15}`);
  console.log(`DeltaY 15 - 50 px:              ${agg.wheelBuckets.b15_50}`);
  console.log(`DeltaY 50 - 120 px:             ${agg.wheelBuckets.b50_120}`);
  console.log(`DeltaY > 120 px:                ${agg.wheelBuckets.gt_120}`);
  console.log("Evidence Label: [Observed]");

  console.log("\n--------------------------------------------------------------------------------");
  console.log("4. RULER TICK GENERATION & CADENCE DENSITY");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Ruler Render Samples:           ${agg.rulerSampleCount}`);
  console.log(`Ruler Avg Render Duration:      ${agg.average(agg.rulerAvgMsSamples)} ms`);
  console.log(`Ruler p95 Render Duration:      ${agg.average(agg.rulerP95MsSamples)} ms (Budget: ≤ 1.0 ms)`);
  console.log(`Ruler Safety Cap Hits (>2500):  ${agg.rulerCapHits} (Budget: 0)`);
  console.log("Active Cadence Histogram:      ", JSON.stringify(agg.cadenceHistogram, null, 2));
  console.log("Evidence Label: [Observed / Derived]");

  console.log("\n--------------------------------------------------------------------------------");
  console.log("5. PLAYHEAD FRAME CELL METRICS");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Frame Cell Update Samples:      ${agg.frameCellSampleCount}`);
  console.log(`Frame Cell Avg Update Cost:     ${agg.average(agg.frameCellAvgUsSamples)} µs`);
  console.log(`Frame Cell p95 Update Cost:     ${agg.average(agg.frameCellP95UsSamples)} µs (Budget: ≤ 50 µs)`);
  console.log(`Frame Index Mismatches:         ${agg.frameCellMismatches} (Budget: 0)`);
  console.log("Evidence Label: [Observed]");

  console.log("\n--------------------------------------------------------------------------------");
  console.log("6. LAYOUT CAP (32M px WebKit / WKWebView Ceiling)");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Layout Cap Engagements:         ${agg.layoutCapEngaged}`);
  console.log(`Peak Scroll Width Observed:     ${agg.layoutCapPeakPx.toLocaleString()} px (Cap: 32,000,000 px)`);
  console.log("Evidence Label: [Observed]");

  console.log("\n--------------------------------------------------------------------------------");
  console.log("7. ARCHITECTURAL INVARIANTS (Contract: All Must Be 0)");
  console.log("--------------------------------------------------------------------------------");
  console.log(`zoom_out_raised_pps:            ${agg.invariants.zoom_out_raised_pps}`);
  console.log(`pps_out_of_bounds:              ${agg.invariants.pps_out_of_bounds}`);
  console.log(`anchor_drift_gt_1px:            ${agg.invariants.anchor_drift_gt_1px}`);
  console.log(`conflicting_max_pps:            ${agg.invariants.conflicting_max_pps}`);

  const allInvariantsPassed =
    agg.invariants.zoom_out_raised_pps === 0 &&
    agg.invariants.pps_out_of_bounds === 0 &&
    agg.invariants.anchor_drift_gt_1px === 0 &&
    agg.invariants.conflicting_max_pps === 0;

  console.log(`Invariant Status:               ${allInvariantsPassed ? "✅ PASS (0 violations)" : "❌ FAILED (violations detected)"}`);
  console.log("Evidence Label: [Observed]");
  console.log("================================================================================\n");
}

main();
