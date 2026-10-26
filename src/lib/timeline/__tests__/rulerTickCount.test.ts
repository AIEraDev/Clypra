/**
 * Regression tests for CLY-BUG-RULER-CAP
 *
 * Root cause: TimelineRuler measured its own el.clientWidth via ResizeObserver.
 * The ruler <div> has width = canvasDuration * pps + startOffset (the full
 * scrollable content width). At pps=6000 with a 286 s timeline that is ~1.9 M px.
 * The tick useMemo treated this as the "viewport width", producing
 *   endStep ≈ canvasDuration / minorInterval  (e.g. 9,480 at frames:0.07 cadence)
 * instead of
 *   endStep ≈ visibleViewportPx / pps / minorInterval  (e.g. 8 ticks)
 * triggering the 2,500-step safety cap on every render.
 *
 * Fix: Timeline passes viewportWidthPx (from timelineStore.viewportWidth, the
 * scroll-container's clientWidth) as a prop, bypassing the ResizeObserver.
 *
 * These tests validate the pure tick-count arithmetic so the invariant can be
 * checked without mounting the React component.
 */

import { describe, it, expect } from "vitest";
import { getTimelineRulerScale } from "../rulerScale";
import { getTimelineCanvasDuration } from "../timelineClip";

const SAFETY_CAP = 2500;
const PAD_PX = 60;

/**
 * Compute the ruler tick count the same way TimelineRuler.tsx useMemo does.
 * Returns { ticks, hitCap } for any combination of inputs.
 */
function computeTickCount({
  pps,
  scrollLeft,
  viewportWidthPx,
  sequenceDuration,
  startOffset,
  frameRate,
}: {
  pps: number;
  scrollLeft: number;
  viewportWidthPx: number;
  sequenceDuration: number;
  startOffset: number;
  frameRate: number;
}): { ticks: number; hitCap: boolean } {
  const { minorIntervalSeconds: minorInterval } = getTimelineRulerScale(pps, frameRate);
  const contentScrollLeft = Math.max(0, scrollLeft - startOffset);
  const canvasDuration = getTimelineCanvasDuration(sequenceDuration);
  const startTime = Math.max(0, (contentScrollLeft - PAD_PX) / pps);
  const rawEndTime = (contentScrollLeft + viewportWidthPx + PAD_PX) / pps;
  const endTime = Math.min(canvasDuration, rawEndTime);
  const startStep = Math.max(0, Math.floor(startTime / minorInterval));
  const endStep = Math.ceil(endTime / minorInterval);
  const steps = endStep - startStep;
  return { ticks: steps, hitCap: steps > SAFETY_CAP };
}

// Representative values mirroring the actual app at 1440px wide window.
const VISIBLE_VIEWPORT_PX = 1440;
const SEQ_DURATION_S = 286; // Heavy urban traffic.wav
const START_OFFSET_PX = 20; // TIMELINE_CLIP_START_OFFSET_PX

describe("ruler tick count — CLY-BUG-RULER-CAP regression", () => {
  // ── Correct behaviour (visible viewport width) ──────────────────────────

  it("generates ≤ 2500 ticks at max zoom (6000 pps) with correct viewport width", () => {
    const { ticks, hitCap } = computeTickCount({
      pps: 6000,
      scrollLeft: 0,
      viewportWidthPx: VISIBLE_VIEWPORT_PX,
      sequenceDuration: SEQ_DURATION_S,
      startOffset: START_OFFSET_PX,
      frameRate: 30,
    });
    expect(hitCap).toBe(false);
    expect(ticks).toBeLessThanOrEqual(20); // ~8 ticks at 6000 pps, 1440px
  });

  it("generates ≤ 2500 ticks at max zoom scrolled to any position", () => {
    // At pps=6000 the user can scroll up to canvasDuration * pps px.
    const canvasDuration = getTimelineCanvasDuration(SEQ_DURATION_S);
    const maxScroll = Math.round(canvasDuration * 6000) + START_OFFSET_PX - VISIBLE_VIEWPORT_PX;
    for (const scrollLeft of [0, maxScroll / 3, maxScroll / 2, maxScroll]) {
      const { ticks, hitCap } = computeTickCount({
        pps: 6000,
        scrollLeft,
        viewportWidthPx: VISIBLE_VIEWPORT_PX,
        sequenceDuration: SEQ_DURATION_S,
        startOffset: START_OFFSET_PX,
        frameRate: 30,
      });
      expect(hitCap).toBe(false);
      expect(ticks).toBeLessThanOrEqual(SAFETY_CAP);
    }
  });

  it("generates ≤ 2500 ticks across the full zoom range with correct viewport width", () => {
    const ppsValues = [9, 15, 30, 50, 100, 200, 500, 1000, 2000, 4000, 6000];
    for (const pps of ppsValues) {
      const { ticks, hitCap } = computeTickCount({
        pps,
        scrollLeft: 0,
        viewportWidthPx: VISIBLE_VIEWPORT_PX,
        sequenceDuration: SEQ_DURATION_S,
        startOffset: START_OFFSET_PX,
        frameRate: 30,
      });
      expect(hitCap).toBe(false);
      expect(ticks).toBeLessThanOrEqual(SAFETY_CAP);
    }
  });

  it("works correctly at 24, 25, 29.97, 60 fps", () => {
    for (const fps of [24, 25, 29.97, 60]) {
      const { ticks, hitCap } = computeTickCount({
        pps: 6000,
        scrollLeft: 0,
        viewportWidthPx: VISIBLE_VIEWPORT_PX,
        sequenceDuration: SEQ_DURATION_S,
        startOffset: START_OFFSET_PX,
        frameRate: fps,
      });
      expect(hitCap).toBe(false);
      expect(ticks).toBeLessThanOrEqual(SAFETY_CAP);
    }
  });

  // ── Demonstrate the original bug (content width passed as viewport) ─────

  it("DEMONSTRATES BUG: cap is hit when full content width is used instead of visible viewport", () => {
    // This is what the old ResizeObserver produced: the full scrollable canvas width.
    const canvasDuration = getTimelineCanvasDuration(SEQ_DURATION_S);
    const contentWidthAsBuggyViewport = Math.round(canvasDuration * 6000) + START_OFFSET_PX;

    const { hitCap } = computeTickCount({
      pps: 6000,
      scrollLeft: 0,
      viewportWidthPx: contentWidthAsBuggyViewport, // ~1.9 M px — the bug
      sequenceDuration: SEQ_DURATION_S,
      startOffset: START_OFFSET_PX,
      frameRate: 30,
    });
    // The buggy path always hits the cap at high zoom with a long timeline.
    expect(hitCap).toBe(true);
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it("handles a short 5 s sequence without hitting cap at any zoom", () => {
    const ppsValues = [9, 50, 500, 6000];
    for (const pps of ppsValues) {
      const { hitCap } = computeTickCount({
        pps,
        scrollLeft: 0,
        viewportWidthPx: VISIBLE_VIEWPORT_PX,
        sequenceDuration: 5,
        startOffset: START_OFFSET_PX,
        frameRate: 30,
      });
      expect(hitCap).toBe(false);
    }
  });

  it("does not trigger the safety cap when scrolled past the timeline end", () => {
    // When scrollLeft places the viewport entirely past canvasDuration, startTime > endTime
    // so the step delta is negative. The for-loop never executes (step <= maxSteps fails
    // immediately), so 0 ticks are actually rendered. The safety cap (steps > 2500) is
    // NOT hit. This test documents that degenerate over-scroll does not cause a cap hit.
    const canvasDuration = getTimelineCanvasDuration(SEQ_DURATION_S);
    const wayBeyond = Math.round(canvasDuration * 6000) * 2;
    const { hitCap } = computeTickCount({
      pps: 6000,
      scrollLeft: wayBeyond,
      viewportWidthPx: VISIBLE_VIEWPORT_PX,
      sequenceDuration: SEQ_DURATION_S,
      startOffset: START_OFFSET_PX,
      frameRate: 30,
    });
    expect(hitCap).toBe(false);
  });
});
