import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { timelineZoomTelemetry } from "../timelineZoomTelemetry";
import {
  calculateDiscreteWheelZoomTarget,
  clampTimelinePixelsPerSecond,
  getTimelineMaxPps,
  TIMELINE_MIN_PPS,
} from "../timelineZoom";
import { TimelineZoomSpring } from "@/hooks/timeline/useTimelineZoomSpring";
import { TimelineRuler } from "@/components/editor/timeline/TimelineRuler";
import { getPlayheadFrameCellLayout } from "@/components/editor/timeline/Playhead";
import { perfLogService } from "@/services/perfLogService";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Timeline Zoom, Ruler & Frame Cell Integration Suite", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    timelineZoomTelemetry.setEnabled(true);
    timelineZoomTelemetry.clear();

    useTimelineStore.setState({
      pixelsPerSecond: 100,
      zoomLevel: 1.0,
      scrollLeft: 0,
      tracks: [],
      clips: [],
      markers: [],
    });

    useProjectStore.setState({
      project: {
        id: "proj-1",
        name: "Test Project",
        duration: 60,
        frameRate: 30,
        aspectRatio: "16:9",
        canvasWidth: 1920,
        canvasHeight: 1080,
        createdAt: 0,
        updatedAt: 0,
      },
    });
  });

  it("simulates a 7-notch discrete wheel traversal from min to max without invariant breaches", () => {
    const frameRate = 30;
    const sequenceDuration = 60;
    const maxPps = getTimelineMaxPps(frameRate, sequenceDuration);
    const minPps = TIMELINE_MIN_PPS; // 10 px/s

    let currentPps = minPps;
    const gestureId = timelineZoomTelemetry.beginGesture("wheel_ruler", currentPps);
    expect(gestureId).toMatch(/^z-[0-9a-f]{6}$/);

    // Zoom IN across 7 discrete notches
    for (let notch = 1; notch <= 7; notch++) {
      const nextPps = calculateDiscreteWheelZoomTarget(
        currentPps,
        1,
        frameRate,
        sequenceDuration,
      );
      timelineZoomTelemetry.recordWheel(-120, 0, true, "ruler");
      timelineZoomTelemetry.recordFrame(16.6);
      currentPps = nextPps;
    }

    expect(Math.round(currentPps)).toBe(Math.round(maxPps));

    // Zoom OUT across 7 discrete notches
    for (let notch = 1; notch <= 7; notch++) {
      const nextPps = calculateDiscreteWheelZoomTarget(
        currentPps,
        -1,
        frameRate,
        sequenceDuration,
      );
      if (nextPps > currentPps + 0.01) {
        timelineZoomTelemetry.recordInvariant("zoom_out_raised_pps");
      }
      timelineZoomTelemetry.recordWheel(120, 0, true, "ruler");
      timelineZoomTelemetry.recordFrame(16.5);
      currentPps = nextPps;
    }

    expect(Math.round(currentPps)).toBe(Math.round(minPps));

    timelineZoomTelemetry.recordSettle(120, false);
    timelineZoomTelemetry.endGesture(currentPps);

    const rollup = timelineZoomTelemetry.drain();
    expect(rollup).toBeDefined();
    expect(rollup?.gestures.count).toBe(1);
    expect(rollup?.wheel.delta_y_buckets[4]).toBe(14); // 14 wheel events with abs(dy) >= 120
    expect(rollup?.invariants.zoom_out_raised_pps).toBe(0);
    expect(rollup?.invariants.pps_out_of_bounds).toBe(0);
    expect(rollup?.invariants.anchor_drift_gt_1px).toBe(0);
    expect(rollup?.invariants.conflicting_max_pps).toBe(0);
    expect(rollup?.anomaly).toBeUndefined();
  });

  it("preserves overview zoom density below 10 px/s when allowOverviewFloor is true", () => {
    // 2 px/s is valid overview zoom for a long sequence
    const clampedOverview = clampTimelinePixelsPerSecond(2, true, 30);
    expect(clampedOverview).toBe(2);

    // Without overview floor flag, it clamps to TIMELINE_MIN_PPS (10 px/s)
    const clampedStandard = clampTimelinePixelsPerSecond(2, false, 30);
    expect(clampedStandard).toBe(TIMELINE_MIN_PPS);
  });

  it("records ruler tick generation time, cadence, and cap hits under varying scale", () => {
    // Render at overview (10 px/s)
    render(<TimelineRuler pixelsPerSecond={10} scrollLeft={0} sequenceDuration={120} />);
    // Render at standard (100 px/s)
    render(<TimelineRuler pixelsPerSecond={100} scrollLeft={0} sequenceDuration={120} />);
    // Render at detail (500 px/s)
    render(<TimelineRuler pixelsPerSecond={500} scrollLeft={0} sequenceDuration={120} />);
    // Render at frame (2400 px/s)
    render(<TimelineRuler pixelsPerSecond={2400} scrollLeft={0} sequenceDuration={120} />);

    const rollup = timelineZoomTelemetry.drain();
    expect(rollup).toBeDefined();
    expect(rollup?.ruler.cap_hits).toBe(0);
    expect(rollup?.ruler.gen_ms_p95).toBeLessThanOrEqual(5.0); // well within budget
    expect(Object.keys(rollup?.ruler.cadence_hist ?? {}).length).toBeGreaterThan(0);
  });

  it("records playhead frame-cell update microsecond cost and verifies zero mismatches", () => {
    for (let f = 0; f < 30; f++) {
      const time = f / 30;
      const layout = getPlayheadFrameCellLayout(time, 2400, 30, 0);
      expect(layout.currentFrame).toBe(f);
      expect(layout.width).toBe(80); // 2400 / 30 = 80px per frame

      // Boundary check just before next frame boundary
      const boundaryTime = (f + 0.999) / 30;
      const boundaryLayout = getPlayheadFrameCellLayout(boundaryTime, 2400, 30, 0);
      expect(boundaryLayout.currentFrame).toBe(f);
    }

    const rollup = timelineZoomTelemetry.drain();
    expect(rollup).toBeDefined();
    expect(rollup?.frame_cell.mismatches).toBe(0);
    expect(rollup?.frame_cell.update_us_p95).toBeGreaterThanOrEqual(0);
  });

  it("canary check: trips anomaly flag when an invariant counter or timeout occurs", () => {
    timelineZoomTelemetry.beginGesture("button", 100);
    timelineZoomTelemetry.recordInvariant("zoom_out_raised_pps");
    timelineZoomTelemetry.recordSettle(2100, true); // timed out
    timelineZoomTelemetry.endGesture(100);

    const rollup = timelineZoomTelemetry.drain();
    expect(rollup).toBeDefined();
    expect(rollup?.anomaly).toBe(true);
    expect(rollup?.invariants.zoom_out_raised_pps).toBe(1);
    expect(rollup?.settle_ms.timeouts).toBe(1);
  });

  it("smooth spring animation avoids visible snap at 2000ms and records timeout anomaly upon settle", () => {
    const container = document.createElement("div");
    container.style.width = "1000px";
    container.scrollLeft = 0;

    const spring = new TimelineZoomSpring(container);
    timelineZoomTelemetry.beginGesture("wheel_ruler", 100);

    let currentTime = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => currentTime);

    // Start spring targeting 500 px/s from 100 px/s
    spring.setTarget(500, {
      localTimelineX: 100,
      anchorTime: 1.0,
      containerWidth: 1000,
      viewportEndSeconds: 60,
      hasClips: false,
    });

    // Advance time past 2000ms (e.g. to 3500ms) while spring ticks
    currentTime = 3500;
    (spring as any).tick();

    // Verify currentPps did NOT snap to 500; it smoothly stepped without jumping
    expect(spring.getCurrentPps()).toBeLessThan(500);
    expect(spring.getCurrentPps()).toBeGreaterThan(100);

    // Let the spring settle (diff = 0.04 < SETTLE_THRESHOLD_PPS 0.08)
    (spring as any).currentPps = 499.96;
    (spring as any).tick();

    expect(spring.getCurrentPps()).toBe(500);

    const rollup = timelineZoomTelemetry.drain();
    expect(rollup).toBeDefined();
    expect(rollup?.settle_ms.timeouts).toBe(1);
    expect(rollup?.anomaly).toBe(true);

    spring.dispose();
    vi.restoreAllMocks();
  });
});
