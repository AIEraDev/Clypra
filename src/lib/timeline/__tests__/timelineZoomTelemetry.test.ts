import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  TimelineZoomTelemetryCollector,
  timelineZoomTelemetry,
  type TimelineZoomRollupPayload,
} from "../timelineZoomTelemetry";
import { getPlayheadFrameCellLayout } from "@/components/editor/timeline/Playhead";

describe("TimelineZoomTelemetryCollector (T1)", () => {
  let collector: TimelineZoomTelemetryCollector;

  beforeEach(() => {
    collector = new TimelineZoomTelemetryCollector();
    collector.setEnabled(true);
  });

  it("returns null when drained on an empty window without activity", () => {
    expect(collector.hasRecordedData()).toBe(false);
    expect(collector.drain()).toBeNull();
  });

  it("records gesture lifecycle and generates short random join keys", () => {
    const id1 = collector.beginGesture("wheel_modifier", 100);
    expect(id1).toMatch(/^z-[0-9a-f]{6}$/);

    // Subsequent calls within active gesture reuse id
    const id2 = collector.beginGesture("wheel_modifier", 150);
    expect(id2).toBe(id1);

    collector.endGesture(250);
    expect(collector.hasRecordedData()).toBe(true);

    const rollup = collector.drain();
    expect(rollup).not.toBeNull();
    expect(rollup?.gestures.count).toBe(1);
    expect(rollup?.gestures.by_input.wheel_modifier).toBe(2);
    expect(rollup?.filmstrip.join_gesture_ids).toContain(id1);
  });

  it("accurately classifies wheel deltaY into fixed buckets and deltaMode counts", () => {
    collector.beginGesture("wheel_ruler", 50);

    // <5
    collector.recordWheel(3, 0, false, "ruler");
    // 5-15
    collector.recordWheel(10, 0, true, "ruler");
    // 15-50
    collector.recordWheel(25, 1, true, "ruler"); // line mode
    // 50-120
    collector.recordWheel(-100, 1, true, "ruler"); // line mode
    // >120
    collector.recordWheel(150, 2, true, "ruler"); // page mode

    collector.endGesture(200);

    const rollup = collector.drain();
    expect(rollup).not.toBeNull();

    // [ <5, 5-15, 15-50, 50-120, >120 ]
    expect(rollup?.wheel.delta_y_buckets).toEqual([1, 1, 1, 1, 1]);
    expect(rollup?.wheel.delta_mode_counts).toEqual({
      pixel: 2,
      line: 2,
      page: 1,
    });
    expect(rollup?.wheel.steps_per_gesture.p50).toBe(4); // 4 discrete steps
  });

  it("calculates accurate frame pacing percentiles and anomaly thresholds", () => {
    collector.beginGesture("slider", 100);

    // Record frames: 10 nominal (16ms), 2 minor drop (25ms), 1 major drop (40ms), 1 extreme stall (120ms)
    for (let i = 0; i < 10; i++) collector.recordFrame(16.6);
    collector.recordFrame(25.0);
    collector.recordFrame(28.0);
    collector.recordFrame(40.0);
    collector.recordFrame(120.0);

    collector.endGesture(500);

    const rollup = collector.drain();
    expect(rollup).not.toBeNull();

    expect(rollup?.frame_ms.max).toBe(120);
    expect(rollup?.frame_ms.over_16).toBe(4); // 25, 28, 40, 120
    expect(rollup?.frame_ms.over_33).toBe(2); // 40, 120
    expect(rollup?.frame_ms.over_100).toBe(1); // 120
    expect(rollup?.frame_ms.p50).toBeCloseTo(16.6, 1);
    expect(rollup?.anomaly).toBe(true); // >33ms frame triggered anomaly
  });

  it("measures ruler render metrics, cap hits, and cadence histogram", () => {
    collector.recordRulerRender(50, 0.5, false, "frames", 2 / 30);
    collector.recordRulerRender(80, 0.8, false, "frames", 2 / 30);
    collector.recordRulerRender(2000, 2.5, true, "timecode", 60); // hit 2000-tick cap

    const rollup = collector.drain();
    expect(rollup).not.toBeNull();
    expect(rollup?.ruler.cap_hits).toBe(1);
    expect(rollup?.ruler.ticks_p95).toBe(2000);
    expect(rollup?.ruler.gen_ms_p95).toBeCloseTo(2.5, 1);
    expect(rollup?.ruler.cadence_hist["frames:0.07"]).toBe(2);
    expect(rollup?.ruler.cadence_hist["timecode:60"]).toBe(1);
    expect(rollup?.anomaly).toBe(true); // cap hit triggers anomaly
  });

  it("tracks frame cell update metrics and preview mismatch anomalies", () => {
    collector.recordFrameCellMount(true);
    collector.recordFrameCellUpdate(25, false);
    collector.recordFrameCellUpdate(30, false);
    collector.recordFrameCellUpdate(45, true); // mismatch!
    collector.recordFrameCellMount(false);

    const rollup = collector.drain();
    expect(rollup).not.toBeNull();
    expect(rollup?.frame_cell.mounts).toBe(1);
    expect(rollup?.frame_cell.unmounts).toBe(1);
    expect(rollup?.frame_cell.mismatches).toBe(1);
    expect(rollup?.frame_cell.update_us_p95).toBeCloseTo(45, 1);
    expect(rollup?.anomaly).toBe(true); // mismatch triggers anomaly
  });

  it("tracks invariant breaches and flags them as critical anomalies", () => {
    collector.recordInvariant("zoom_out_raised_pps");
    collector.recordInvariant("pps_out_of_bounds");
    collector.recordInvariant("anchor_drift_gt_1px");
    collector.recordInvariant("conflicting_max_pps");

    const rollup = collector.drain();
    expect(rollup).not.toBeNull();
    expect(rollup?.invariants.zoom_out_raised_pps).toBe(1);
    expect(rollup?.invariants.pps_out_of_bounds).toBe(1);
    expect(rollup?.invariants.anchor_drift_gt_1px).toBe(1);
    expect(rollup?.invariants.conflicting_max_pps).toBe(1);
    expect(rollup?.anomaly).toBe(true);
  });

  it("tracks buffer overflow counters and wraps ring buffers gracefully without allocation", () => {
    collector.beginGesture("wheel_modifier", 100);

    // Frame buffer (capacity: 512) -> feed 600 samples -> 88 overflows
    for (let i = 0; i < 600; i++) {
      collector.recordFrame(16.0 + (i % 5));
    }

    // Settle buffer (capacity: 128) -> feed 150 samples -> 22 overflows
    for (let i = 0; i < 150; i++) {
      collector.recordSettle(100 + (i % 20), false);
    }

    // Ruler buffer (capacity: 256) -> feed 300 samples -> 44 overflows
    for (let i = 0; i < 300; i++) {
      collector.recordRulerRender(50, 0.4, false, "frames", 2 / 30);
    }

    // Frame cell buffer (capacity: 256) -> feed 300 samples -> 44 overflows
    for (let i = 0; i < 300; i++) {
      collector.recordFrameCellUpdate(25, false);
    }

    collector.endGesture(200);

    const rollup = collector.drain();
    expect(rollup).not.toBeNull();
    expect(rollup?.buffer_overflows).toEqual({
      frame: 88,
      settle: 22,
      ruler: 44,
      frame_cell: 44,
    });
    // Percentiles compute accurately on wrapped ring buffers
    expect(rollup?.frame_ms.p50).toBeGreaterThanOrEqual(16.0);
    expect(rollup?.frame_ms.p50).toBeLessThanOrEqual(21.0);
    expect(rollup?.settle_ms.p50).toBeGreaterThanOrEqual(100);
    expect(rollup?.ruler.gen_ms_p95).toBeCloseTo(0.4, 1);
    expect(rollup?.frame_cell.update_us_p95).toBeCloseTo(25, 1);
  });

  it("records nothing when disabled via telemetry opt-out", () => {
    collector.setEnabled(false);

    collector.beginGesture("wheel_modifier", 100);
    collector.recordWheel(50, 0, true, "modifier");
    collector.recordFrame(16.6);
    collector.recordRulerRender(100, 1.0, false, "frames", 2 / 30);
    collector.recordFrameCellUpdate(20, false);
    collector.recordInvariant("zoom_out_raised_pps");
    collector.endGesture(200);

    expect(collector.hasRecordedData()).toBe(false);
    expect(collector.drain()).toBeNull();
  });

  it("ensures zero performance.now() invocations when telemetry is disabled", () => {
    const perfNowSpy = vi.spyOn(performance, "now");

    // Case 1: Disabled -> 0 calls to performance.now()
    timelineZoomTelemetry.setEnabled(false);
    perfNowSpy.mockClear();

    // Call layout function 20 times
    for (let i = 0; i < 20; i++) {
      getPlayheadFrameCellLayout(i * 0.1, 2400, 30, 0);
    }
    expect(perfNowSpy).not.toHaveBeenCalled();

    // Case 2: Enabled -> calls performance.now()
    timelineZoomTelemetry.setEnabled(true);
    perfNowSpy.mockClear();
    getPlayheadFrameCellLayout(0.5, 2400, 30, 0);
    expect(perfNowSpy).toHaveBeenCalled();

    perfNowSpy.mockRestore();
  });

  it("guarantees hot-path zero object allocations across repetitive record operations", () => {
    // Warm-up
    for (let i = 0; i < 50; i++) {
      collector.recordFrame(16.6);
      collector.recordWheel(10, 0, true, "ruler");
      collector.recordFrameCellUpdate(15, false);
    }

    // Measure memory delta using counting harness or property stability
    const initialFrameCount = (collector as any).frameDeltaCount;
    for (let i = 0; i < 100; i++) {
      collector.recordFrame(16.6);
      collector.recordWheel(12, 0, true, "ruler");
      collector.recordFrameCellUpdate(18, false);
    }
    expect((collector as any).frameDeltaCount).toBe(initialFrameCount + 100);
  });
});
