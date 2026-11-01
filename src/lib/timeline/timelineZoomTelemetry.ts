/**
 * Timeline Zoom, Ruler & Frame Cell Performance Telemetry Collector
 *
 * Responsibilities:
 * - Instruments timeline zoom gestures (wheel, trackpad, pinch, toolbar, keyboard, fit).
 * - Tracks rAF frame pacing (p50/p95/max, drops over 16.7ms/33ms/100ms) during zoom gestures.
 * - Records spring settle time and timeout anomalies.
 * - Records ruler tick generation time, tick count, cap hits, and active cadence.
 * - Measures playhead current-frame cell update cost (µs) and frame-index parity against getFrameIndexAtTime.
 * - Guards invariant counters (must stay 0) and detects 32M px layout cap engagement.
 * - Strictly zero PII: numeric timings, fixed buckets, and anonymous short gesture IDs only.
 * - Strictly zero-allocation on the rAF, wheel, and scrub hot paths.
 */

import { PerfLogService } from "@/services/perfLogService";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";

export type ZoomInputKind =
  | "wheel_ruler"
  | "wheel_modifier"
  | "pinch"
  | "button"
  | "keyboard"
  | "slider"
  | "fit";

export type ZoomWheelModifier = "ruler" | "modifier" | "pinch";

export interface TimelineZoomRollupPayload {
  schema_version: 1;
  window_ms: number;
  anomaly?: boolean;
  context: {
    dpr: number;
    os_family: "macos" | "windows" | "linux" | "other";
    frame_rate_bucket: "24" | "30" | "60" | "other";
    sequence_duration_bucket: "<1m" | "1-10m" | "10-60m" | ">60m";
    clip_count_bucket: "0" | "1-10" | "11-50" | ">50";
  };
  gestures: {
    count: number;
    by_input: Record<ZoomInputKind, number>;
  };
  frame_ms: {
    p50: number;
    p95: number;
    max: number;
    over_16: number;
    over_33: number;
    over_100: number;
  };
  settle_ms: {
    p50: number;
    p95: number;
    timeouts: number;
  };
  wheel: {
    delta_y_buckets: [number, number, number, number, number]; // <5, 5-15, 15-50, 50-120, >120
    delta_mode_counts: {
      pixel: number;
      line: number;
      page: number;
    };
    events_per_gesture: {
      p50: number;
      p95: number;
    };
    steps_per_gesture: {
      p50: number;
      p95: number;
    };
  };
  ruler: {
    ticks_p95: number;
    gen_ms_p95: number;
    rerenders_per_s_p95: number;
    cap_hits: number;
    cadence_hist: Record<string, number>;
  };
  frame_cell: {
    update_us_p95: number;
    mounts: number;
    unmounts: number;
    mismatches: number;
  };
  layout_cap: {
    engaged: number;
    peak_px: number;
  };
  filmstrip: {
    join_gesture_ids: string[];
  };
  invariants: {
    zoom_out_raised_pps: number;
    pps_out_of_bounds: number;
    anchor_drift_gt_1px: number;
    conflicting_max_pps: number;
  };
  buffer_overflows: {
    frame: number;
    settle: number;
    ruler: number;
    frame_cell: number;
  };
  collector: {
    event_us_p95: number;
  };
}

function computePercentile(
  samples: ArrayLike<number>,
  count: number,
  percentile: number,
): number {
  if (count <= 0) return 0;
  const len = Math.min(count, samples.length);
  const arr = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = samples[i];
  }
  arr.sort();
  const idx = Math.min(
    len - 1,
    Math.max(0, Math.ceil((percentile / 100) * len) - 1),
  );
  return Math.round(arr[idx] * 100) / 100;
}

export class TimelineZoomTelemetryCollector {
  private enabled: boolean = true;
  private windowStartEpochMs: number = Date.now();

  // ── Preallocated Buffers (Hot-path zero allocation) ──────────────────────────
  private readonly MAX_FRAME_SAMPLES = 512;
  private frameDeltas = new Float32Array(512);
  private frameDeltaCount = 0;
  private frameOverflowCount = 0;

  private readonly MAX_SETTLE_SAMPLES = 128;
  private settleTimes = new Float32Array(128);
  private settleTimeCount = 0;
  private settleOverflowCount = 0;

  private readonly MAX_RULER_SAMPLES = 256;
  private rulerTicks = new Int32Array(256);
  private rulerGenTimes = new Float32Array(256);
  private rulerSampleCount = 0;
  private rulerOverflowCount = 0;

  private readonly MAX_CELL_SAMPLES = 256;
  private frameCellUpdateUs = new Float32Array(256);
  private frameCellSampleCount = 0;
  private frameCellOverflowCount = 0;

  private readonly MAX_COLLECTOR_SAMPLES = 128;
  private collectorTimesUs = new Float32Array(128);
  private collectorSampleCount = 0;

  // ── Gesture Tracking ────────────────────────────────────────────────────────
  private activeGestureId: string | null = null;
  private activeGestureKind: ZoomInputKind = "wheel_modifier";
  private activeGestureStartPps: number = 0;
  private activeGestureInputEvents: number = 0;
  private activeGestureSteps: number = 0;
  private completedGestureEvents = new Int32Array(64);
  private completedGestureSteps = new Int32Array(64);
  private completedGestureCount = 0;
  private gestureIdsSample: string[] = [];

  // ── Counters & Buckets ──────────────────────────────────────────────────────
  private frameOver16 = 0;
  private frameOver33 = 0;
  private frameOver100 = 0;
  private frameMaxMs = 0;
  private settleTimeouts = 0;

  // Wheel buckets: 0: <5, 1: 5-15, 2: 15-50, 3: 50-120, 4: >120
  private deltaYBuckets = new Int32Array(5);
  // DeltaMode: 0: DOM_DELTA_PIXEL, 1: DOM_DELTA_LINE, 2: DOM_DELTA_PAGE
  private deltaModeCounts = new Int32Array(3);

  private inputKindCounts: Record<ZoomInputKind, number> = {
    wheel_ruler: 0,
    wheel_modifier: 0,
    pinch: 0,
    button: 0,
    keyboard: 0,
    slider: 0,
    fit: 0,
  };

  private rulerCapHits = 0;
  private rulerRerenders = 0;
  private cadenceHistogram: Record<string, number> = {};

  private frameCellMounts = 0;
  private frameCellUnmounts = 0;
  private frameCellMismatches = 0;

  private layoutCapEngaged = 0;
  private layoutCapPeakPx = 0;

  // ── Invariant Violation Counters (Must stay 0) ──────────────────────────────
  private invariantZoomOutRaisedPps = 0;
  private invariantPpsOutOfBounds = 0;
  private invariantAnchorDriftGt1px = 0;
  private invariantConflictingMaxPps = 0;

  constructor() {
    this.resetBuffers();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public hasRecordedData(): boolean {
    return (
      this.completedGestureCount > 0 ||
      this.activeGestureId !== null ||
      this.frameDeltaCount > 0 ||
      this.settleTimeCount > 0 ||
      this.rulerSampleCount > 0 ||
      this.frameCellSampleCount > 0 ||
      this.frameCellMounts > 0 ||
      this.frameCellUnmounts > 0 ||
      this.layoutCapEngaged > 0 ||
      this.invariantZoomOutRaisedPps > 0 ||
      this.invariantPpsOutOfBounds > 0 ||
      this.invariantAnchorDriftGt1px > 0 ||
      this.invariantConflictingMaxPps > 0
    );
  }

  public clear(): void {
    this.resetBuffers();
  }

  private resetBuffers(): void {
    this.windowStartEpochMs = Date.now();
    this.frameDeltaCount = 0;
    this.settleTimeCount = 0;
    this.rulerSampleCount = 0;
    this.frameCellSampleCount = 0;
    this.collectorSampleCount = 0;

    this.activeGestureId = null;
    this.activeGestureInputEvents = 0;
    this.activeGestureSteps = 0;
    this.completedGestureCount = 0;
    this.gestureIdsSample = [];

    this.frameOver16 = 0;
    this.frameOver33 = 0;
    this.frameOver100 = 0;
    this.frameMaxMs = 0;
    this.settleTimeouts = 0;

    this.deltaYBuckets.fill(0);
    this.deltaModeCounts.fill(0);

    for (const k of Object.keys(this.inputKindCounts)) {
      this.inputKindCounts[k as ZoomInputKind] = 0;
    }

    this.rulerCapHits = 0;
    this.rulerRerenders = 0;
    this.cadenceHistogram = {};

    this.frameCellMounts = 0;
    this.frameCellUnmounts = 0;
    this.frameCellMismatches = 0;

    this.layoutCapEngaged = 0;
    this.layoutCapPeakPx = 0;

    this.frameOverflowCount = 0;
    this.settleOverflowCount = 0;
    this.rulerOverflowCount = 0;
    this.frameCellOverflowCount = 0;

    this.invariantZoomOutRaisedPps = 0;
    this.invariantPpsOutOfBounds = 0;
    this.invariantAnchorDriftGt1px = 0;
    this.invariantConflictingMaxPps = 0;
  }

  // ── Event Collection APIs (Hot-path optimized) ──────────────────────────────

  /**
   * Begin or extend a timeline zoom gesture.
   * Returns a short anonymous gesture ID suitable for offline correlation.
   */
  public beginGesture(kind: ZoomInputKind, startPps: number): string {
    if (!this.isEnabled()) return "";

    const t0 = performance.now();
    this.inputKindCounts[kind]++;

    if (this.activeGestureId) {
      this.activeGestureInputEvents++;
      this.recordCollectorDuration(performance.now() - t0);
      return this.activeGestureId;
    }

    // Short random id: "z-" + 6 random hex chars
    const rand = Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, "0");
    const gestureId = `z-${rand}`;
    this.activeGestureId = gestureId;
    this.activeGestureKind = kind;
    this.activeGestureStartPps = startPps;
    this.activeGestureInputEvents = 1;
    this.activeGestureSteps = 0;

    if (this.gestureIdsSample.length < 16) {
      this.gestureIdsSample.push(gestureId);
    }

    this.recordCollectorDuration(performance.now() - t0);
    return gestureId;
  }

  /**
   * Record a wheel event during a zoom gesture.
   */
  public recordWheel(
    deltaY: number,
    deltaMode: number,
    isDiscrete: boolean,
    modifier: ZoomWheelModifier,
  ): void {
    if (!this.isEnabled()) return;
    const t0 = performance.now();

    const absDy = Math.abs(deltaY);
    if (absDy < 5) this.deltaYBuckets[0]++;
    else if (absDy < 15) this.deltaYBuckets[1]++;
    else if (absDy < 50) this.deltaYBuckets[2]++;
    else if (absDy < 120) this.deltaYBuckets[3]++;
    else this.deltaYBuckets[4]++;

    if (deltaMode === 1) this.deltaModeCounts[1]++;
    else if (deltaMode === 2) this.deltaModeCounts[2]++;
    else this.deltaModeCounts[0]++;

    if (isDiscrete) {
      this.activeGestureSteps++;
    }

    this.recordCollectorDuration(performance.now() - t0);
  }

  /**
   * Record one rAF frame-to-frame delta during zoom spring animation.
   */
  public recordFrame(frameDeltaMs: number): void {
    if (!this.isEnabled() || !Number.isFinite(frameDeltaMs) || frameDeltaMs < 0) return;

    if (frameDeltaMs > this.frameMaxMs) this.frameMaxMs = frameDeltaMs;
    if (frameDeltaMs > 16.7) this.frameOver16++;
    if (frameDeltaMs > 33) this.frameOver33++;
    if (frameDeltaMs > 100) this.frameOver100++;

    if (this.frameDeltaCount >= this.MAX_FRAME_SAMPLES) {
      this.frameOverflowCount++;
    }
    const idx = this.frameDeltaCount % this.MAX_FRAME_SAMPLES;
    this.frameDeltas[idx] = frameDeltaMs;
    this.frameDeltaCount++;
  }

  /**
   * Record spring settle duration (time from last input to idle).
   */
  public recordSettle(durationMs: number, timedOut: boolean): void {
    if (!this.isEnabled() || !Number.isFinite(durationMs) || durationMs < 0) return;

    if (timedOut) {
      this.settleTimeouts++;
    }
    if (this.settleTimeCount >= this.MAX_SETTLE_SAMPLES) {
      this.settleOverflowCount++;
    }
    const idx = this.settleTimeCount % this.MAX_SETTLE_SAMPLES;
    this.settleTimes[idx] = durationMs;
    this.settleTimeCount++;
  }

  /**
   * End the current zoom gesture.
   */
  public endGesture(endPps: number): void {
    if (!this.isEnabled() || !this.activeGestureId) return;

    // Check invariant: if zooming out, endPps must not exceed startPps + epsilon
    if (endPps > this.activeGestureStartPps + 0.01 && this.activeGestureKind === "wheel_modifier") {
      // Checked during discrete out-events
    }

    if (this.completedGestureCount < this.completedGestureEvents.length) {
      this.completedGestureEvents[this.completedGestureCount] =
        this.activeGestureInputEvents;
      this.completedGestureSteps[this.completedGestureCount] =
        this.activeGestureSteps;
      this.completedGestureCount++;
    }

    this.activeGestureId = null;
    this.activeGestureInputEvents = 0;
    this.activeGestureSteps = 0;
  }

  /**
   * Record ruler render performance and cadence.
   */
  public recordRulerRender(
    tickCount: number,
    durationMs: number,
    hitCapLimit: boolean,
    labelMode: "frames" | "timecode",
    majorIntervalSeconds: number,
  ): void {
    if (!this.isEnabled()) return;
    this.rulerRerenders++;
    if (hitCapLimit) {
      this.rulerCapHits++;
    }

    if (this.rulerSampleCount >= this.MAX_RULER_SAMPLES) {
      this.rulerOverflowCount++;
    }
    const idx = this.rulerSampleCount % this.MAX_RULER_SAMPLES;
    this.rulerTicks[idx] = tickCount;
    this.rulerGenTimes[idx] = durationMs;
    this.rulerSampleCount++;

    const cadenceKey = `${labelMode}:${Math.round(majorIntervalSeconds * 100) / 100}`;
    this.cadenceHistogram[cadenceKey] =
      (this.cadenceHistogram[cadenceKey] ?? 0) + 1;
  }

  /**
   * Record current-frame cell update cost (µs) and frame-index parity against preview.
   */
  public recordFrameCellUpdate(durationUs: number, mismatchWithPreview: boolean): void {
    if (!this.isEnabled()) return;

    if (mismatchWithPreview) {
      this.frameCellMismatches++;
    }

    if (this.frameCellSampleCount >= this.MAX_CELL_SAMPLES) {
      this.frameCellOverflowCount++;
    }
    const idx = this.frameCellSampleCount % this.MAX_CELL_SAMPLES;
    this.frameCellUpdateUs[idx] = durationUs;
    this.frameCellSampleCount++;
  }

  public recordFrameCellMount(mounted: boolean): void {
    if (!this.isEnabled()) return;
    if (mounted) this.frameCellMounts++;
    else this.frameCellUnmounts++;
  }

  /**
   * Record when effective max PPS is constrained by the 32M px scroll width ceiling.
   */
  public recordCapEngaged(peakPx: number): void {
    if (!this.isEnabled()) return;
    this.layoutCapEngaged++;
    if (peakPx > this.layoutCapPeakPx) {
      this.layoutCapPeakPx = peakPx;
    }
  }

  /**
   * Record an invariant breach (should always remain 0).
   */
  public recordInvariant(
    name:
      | "zoom_out_raised_pps"
      | "pps_out_of_bounds"
      | "anchor_drift_gt_1px"
      | "conflicting_max_pps",
  ): void {
    if (!this.isEnabled()) return;
    switch (name) {
      case "zoom_out_raised_pps":
        this.invariantZoomOutRaisedPps++;
        break;
      case "pps_out_of_bounds":
        this.invariantPpsOutOfBounds++;
        break;
      case "anchor_drift_gt_1px":
        this.invariantAnchorDriftGt1px++;
        break;
      case "conflicting_max_pps":
        this.invariantConflictingMaxPps++;
        break;
    }
  }

  private recordCollectorDuration(durationMs: number): void {
    const durationUs = durationMs * 1000;
    const idx = this.collectorSampleCount % this.MAX_COLLECTOR_SAMPLES;
    this.collectorTimesUs[idx] = durationUs;
    this.collectorSampleCount++;
  }

  // ── Context Resolution (Zero-PII) ──────────────────────────────────────────

  private resolveContext(): TimelineZoomRollupPayload["context"] {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    let os_family: TimelineZoomRollupPayload["context"]["os_family"] = "other";
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent;
      if (ua.includes("Mac")) os_family = "macos";
      else if (ua.includes("Win")) os_family = "windows";
      else if (ua.includes("Linux")) os_family = "linux";
    }

    const project = useProjectStore.getState().project;
    const fps: number = Number(project?.frameRate ?? 30);
    let frame_rate_bucket: TimelineZoomRollupPayload["context"]["frame_rate_bucket"] =
      "other";
    if (fps === 24 || Math.abs(fps - 23.976) < 0.05 || Math.abs(fps - 23.98) < 0.05) frame_rate_bucket = "24";
    else if (fps === 30 || Math.abs(fps - 29.97) < 0.05) frame_rate_bucket = "30";
    else if (fps === 60 || Math.abs(fps - 59.94) < 0.05) frame_rate_bucket = "60";

    const duration = project?.duration ?? 0;
    let sequence_duration_bucket: TimelineZoomRollupPayload["context"]["sequence_duration_bucket"] =
      "<1m";
    if (duration > 3600) sequence_duration_bucket = ">60m";
    else if (duration > 600) sequence_duration_bucket = "10-60m";
    else if (duration > 60) sequence_duration_bucket = "1-10m";

    const clipCount = useTimelineStore.getState().clips.length;
    let clip_count_bucket: TimelineZoomRollupPayload["context"]["clip_count_bucket"] =
      "0";
    if (clipCount > 50) clip_count_bucket = ">50";
    else if (clipCount > 10) clip_count_bucket = "11-50";
    else if (clipCount > 0) clip_count_bucket = "1-10";

    return {
      dpr,
      os_family,
      frame_rate_bucket,
      sequence_duration_bucket,
      clip_count_bucket,
    };
  }

  // ── Rollup Extraction ───────────────────────────────────────────────────────

  /**
   * Drain the current interval into a structured rollup payload and reset.
   * Returns null if no activity occurred during this flush window.
   */
  public drain(): TimelineZoomRollupPayload | null {
    if (!this.hasRecordedData()) return null;

    const windowMs = Math.max(1, Date.now() - this.windowStartEpochMs);
    const windowSeconds = windowMs / 1000;

    const hasAnomaly =
      this.frameOver33 > 0 ||
      this.settleTimeouts > 0 ||
      this.layoutCapEngaged > 0 ||
      this.rulerCapHits > 0 ||
      this.frameCellMismatches > 0 ||
      this.invariantZoomOutRaisedPps > 0 ||
      this.invariantPpsOutOfBounds > 0 ||
      this.invariantAnchorDriftGt1px > 0 ||
      this.invariantConflictingMaxPps > 0;

    const payload: TimelineZoomRollupPayload = {
      schema_version: 1,
      window_ms: windowMs,
      anomaly: hasAnomaly ? true : undefined,
      context: this.resolveContext(),
      gestures: {
        count: this.completedGestureCount + (this.activeGestureId ? 1 : 0),
        by_input: { ...this.inputKindCounts },
      },
      frame_ms: {
        p50: computePercentile(this.frameDeltas, this.frameDeltaCount, 50),
        p95: computePercentile(this.frameDeltas, this.frameDeltaCount, 95),
        max: Math.round(this.frameMaxMs * 100) / 100,
        over_16: this.frameOver16,
        over_33: this.frameOver33,
        over_100: this.frameOver100,
      },
      settle_ms: {
        p50: computePercentile(this.settleTimes, this.settleTimeCount, 50),
        p95: computePercentile(this.settleTimes, this.settleTimeCount, 95),
        timeouts: this.settleTimeouts,
      },
      wheel: {
        delta_y_buckets: [
          this.deltaYBuckets[0],
          this.deltaYBuckets[1],
          this.deltaYBuckets[2],
          this.deltaYBuckets[3],
          this.deltaYBuckets[4],
        ],
        delta_mode_counts: {
          pixel: this.deltaModeCounts[0],
          line: this.deltaModeCounts[1],
          page: this.deltaModeCounts[2],
        },
        events_per_gesture: {
          p50: computePercentile(
            this.completedGestureEvents,
            this.completedGestureCount,
            50,
          ),
          p95: computePercentile(
            this.completedGestureEvents,
            this.completedGestureCount,
            95,
          ),
        },
        steps_per_gesture: {
          p50: computePercentile(
            this.completedGestureSteps,
            this.completedGestureCount,
            50,
          ),
          p95: computePercentile(
            this.completedGestureSteps,
            this.completedGestureCount,
            95,
          ),
        },
      },
      ruler: {
        ticks_p95: computePercentile(this.rulerTicks, this.rulerSampleCount, 95),
        gen_ms_p95: computePercentile(
          this.rulerGenTimes,
          this.rulerSampleCount,
          95,
        ),
        rerenders_per_s_p95:
          Math.round((this.rulerRerenders / windowSeconds) * 100) / 100,
        cap_hits: this.rulerCapHits,
        cadence_hist: { ...this.cadenceHistogram },
      },
      frame_cell: {
        update_us_p95: computePercentile(
          this.frameCellUpdateUs,
          this.frameCellSampleCount,
          95,
        ),
        mounts: this.frameCellMounts,
        unmounts: this.frameCellUnmounts,
        mismatches: this.frameCellMismatches,
      },
      layout_cap: {
        engaged: this.layoutCapEngaged,
        peak_px: this.layoutCapPeakPx,
      },
      filmstrip: {
        join_gesture_ids: [...this.gestureIdsSample],
      },
      invariants: {
        zoom_out_raised_pps: this.invariantZoomOutRaisedPps,
        pps_out_of_bounds: this.invariantPpsOutOfBounds,
        anchor_drift_gt_1px: this.invariantAnchorDriftGt1px,
        conflicting_max_pps: this.invariantConflictingMaxPps,
      },
      buffer_overflows: {
        frame: this.frameOverflowCount,
        settle: this.settleOverflowCount,
        ruler: this.rulerOverflowCount,
        frame_cell: this.frameCellOverflowCount,
      },
      collector: {
        event_us_p95: computePercentile(
          this.collectorTimesUs,
          this.collectorSampleCount,
          95,
        ),
      },
    };

    this.resetBuffers();
    return payload;
  }
}

export const timelineZoomTelemetry = new TimelineZoomTelemetryCollector();
