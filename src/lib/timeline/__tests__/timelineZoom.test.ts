import { describe, expect, it } from "vitest";
import {
  calculateDiscreteWheelZoomTarget,
  clampTimelinePixelsPerSecond,
  clampTimelineZoom,
  getTimelineMaxPps,
  getTimelineZoomMax,
  getZoomFromRatio,
  getZoomRatio,
  snapTimelineZoomToTierAnchors,
  MAX_SAFE_SCROLL_WIDTH_PX,
  TIMELINE_MAX_PX_PER_FRAME,
  TIMELINE_MIN_PPS,
  TIMELINE_ZOOM_MIN,
} from "../timelineZoom";
import { getTimelineRulerScale } from "../rulerScale";
import { getTimelineScrollContentWidth } from "../timelineViewport";

describe("timeline zoom depth and bounds (W3)", () => {
  it("computes maxPps and maxZoom based on 200 CSS px/frame across project frame rates (D1)", () => {
    // 24 fps: 200 * 24 = 4,800 px/s (zoom 48.0)
    expect(getTimelineMaxPps(24)).toBe(4800);
    expect(getTimelineZoomMax(24)).toBe(48);

    // 30 fps: 200 * 30 = 6,000 px/s (zoom 60.0)
    expect(getTimelineMaxPps(30)).toBe(6000);
    expect(getTimelineZoomMax(30)).toBe(60);

    // 60 fps: 200 * 60 = 12,000 px/s (zoom 120.0)
    expect(getTimelineMaxPps(60)).toBe(12000);
    expect(getTimelineZoomMax(60)).toBe(120);
  });

  it("saturates clampTimelineZoom and clampTimelinePixelsPerSecond at the exact same max for each fps", () => {
    for (const fps of [24, 30, 60]) {
      const maxPps = getTimelineMaxPps(fps);
      const maxZoom = getTimelineZoomMax(fps);

      expect(clampTimelinePixelsPerSecond(999999, false, fps)).toBe(maxPps);
      expect(clampTimelineZoom(999999, fps)).toBe(maxZoom);
      expect(maxZoom * 100).toBe(maxPps);
    }
  });

  it("produces 2-frame major cadence with 1-frame minor ticks at max zoom for all frame rates", () => {
    for (const fps of [24, 30, 60]) {
      const maxPps = getTimelineMaxPps(fps);
      const scale = getTimelineRulerScale(maxPps, fps);

      expect(scale.labelMode).toBe("frames");
      expect(scale.majorIntervalSeconds).toBeCloseTo(2 / fps);
      expect(scale.minorIntervalSeconds).toBeCloseTo(1 / fps);
    }
  });

  it("maps slider ratio logarithmically and saturates exactly at maxZoom at ratio=1.0", () => {
    for (const fps of [24, 30, 60]) {
      const maxZoom = getTimelineZoomMax(fps);

      // Bottom of slider
      expect(getZoomRatio(TIMELINE_ZOOM_MIN, fps)).toBeCloseTo(0, 5);
      expect(getZoomFromRatio(0, fps)).toBeCloseTo(TIMELINE_ZOOM_MIN, 5);

      // Top of slider
      expect(getZoomRatio(maxZoom, fps)).toBeCloseTo(1, 5);
      expect(getZoomFromRatio(1, fps)).toBeCloseTo(maxZoom, 5);

      // Mid-slider monotonicity
      const ratio25 = getZoomFromRatio(0.25, fps);
      const ratio50 = getZoomFromRatio(0.5, fps);
      const ratio75 = getZoomFromRatio(0.75, fps);
      expect(ratio25).toBeGreaterThan(TIMELINE_ZOOM_MIN);
      expect(ratio50).toBeGreaterThan(ratio25);
      expect(ratio75).toBeGreaterThan(ratio50);
      expect(maxZoom).toBeGreaterThan(ratio75);

      // Snapping at maxZoom
      expect(
        snapTimelineZoomToTierAnchors(maxZoom - 0.01, undefined, fps),
      ).toBe(maxZoom);
    }
  });

  it("wheel zoom-out floor matches zoom-button floor (regression: was allowOverviewFloor=true)", () => {
    // Discrete wheel: zooming out with an absurd notch count must not go below TIMELINE_MIN_PPS.
    // This was broken — calculateDiscreteWheelZoomTarget passed allowOverviewFloor=true which
    // allowed zoom down to ~0.0001 px/s, far below the 10 px/s button floor.
    for (const fps of [24, 30, 60]) {
      const result = calculateDiscreteWheelZoomTarget(
        TIMELINE_MIN_PPS,
        -1000,
        fps,
      );
      expect(result).toBeGreaterThanOrEqual(TIMELINE_MIN_PPS);
    }

    // Starting from a mid-range PPS, many zoom-out notches must still floor at TIMELINE_MIN_PPS.
    const midPps = 100; // zoom level 1.0
    expect(
      calculateDiscreteWheelZoomTarget(midPps, -100, 30),
    ).toBeGreaterThanOrEqual(TIMELINE_MIN_PPS);

    // Continuous trackpad: the same clamp (allowOverviewFloor=false) must apply.
    // Simulate the equivalent exponential decay with a large positive dy.
    // Max exponent is clamped to -0.22, so basePps * e^(-0.22) is the per-frame floor factor.
    // After many frames of compound zoom-out starting from TIMELINE_MIN_PPS, result stays >= TIMELINE_MIN_PPS.
    const continuousResult = clampTimelinePixelsPerSecond(
      TIMELINE_MIN_PPS * Math.exp(-0.22),
      false, // allowOverviewFloor=false — this is what the fixed trackpad path now passes
      30,
    );
    expect(continuousResult).toBeGreaterThanOrEqual(TIMELINE_MIN_PPS);
  });

  it("prevents WebKit DOM layout overflow on 10-minute and 1-hour sequences", () => {
    // 10-minute sequence (600s)
    const tenMinDuration = 600;
    const tenMinMaxPps30 = getTimelineMaxPps(30, tenMinDuration);
    expect(tenMinMaxPps30).toBe(6000); // full 200 px/frame preserved
    const tenMinScrollWidth = getTimelineScrollContentWidth(
      tenMinDuration + 2,
      tenMinMaxPps30,
      true,
    );
    expect(tenMinScrollWidth).toBeLessThan(MAX_SAFE_SCROLL_WIDTH_PX);

    // 1-hour sequence (3600s) at 30 fps
    const oneHourDuration = 3600;
    const oneHourMaxPps30 = getTimelineMaxPps(30, oneHourDuration);
    expect(oneHourMaxPps30).toBe(6000); // 21.6M px is within 32M safe limit
    const oneHourScrollWidth30 = getTimelineScrollContentWidth(
      oneHourDuration + 2,
      oneHourMaxPps30,
      true,
    );
    expect(oneHourScrollWidth30).toBeLessThan(MAX_SAFE_SCROLL_WIDTH_PX);

    // 1-hour sequence (3600s) at 60 fps: base 12,000 px/s would exceed 43M px, capped safely below 32M px
    const oneHourMaxPps60 = getTimelineMaxPps(60, oneHourDuration);
    const oneHourScrollWidth60 = getTimelineScrollContentWidth(
      oneHourDuration + 2,
      oneHourMaxPps60,
      true,
    );
    expect(oneHourScrollWidth60).toBeLessThanOrEqual(MAX_SAFE_SCROLL_WIDTH_PX);
  });
});
