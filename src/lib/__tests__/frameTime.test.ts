/**
 * Frame Time Utilities Tests
 *
 * Tests frame snapping logic that ensures splits and scrubs
 * align with real decoder frame boundaries.
 */

import { describe, it, expect } from "vitest";
import {
  snapToFrameBoundary,
  snapToFrameFloor,
  snapToFrameCeil,
  getFrameIndex,
  getFrameIndexAtTime,
  getFrameStartTime,
  getTimeFromFrame,
} from "../utils/frameTime";

describe("frameTime utilities", () => {
  describe("snapToFrameBoundary", () => {
    it("snaps to nearest frame at 30fps", () => {
      expect(snapToFrameBoundary(0.0, 30)).toBe(0.0);
      expect(snapToFrameBoundary(0.016, 30)).toBe(0.0); // Closer to frame 0
      expect(snapToFrameBoundary(0.017, 30)).toBeCloseTo(0.0333, 4); // Closer to frame 1
      expect(snapToFrameBoundary(1.0, 30)).toBe(1.0);
    });

    it("snaps to nearest frame at 24fps", () => {
      expect(snapToFrameBoundary(0.0, 24)).toBe(0.0);
      expect(snapToFrameBoundary(0.02, 24)).toBe(0.0); // Closer to frame 0
      expect(snapToFrameBoundary(0.022, 24)).toBeCloseTo(0.0417, 4); // Closer to frame 1
      expect(snapToFrameBoundary(1.0, 24)).toBe(1.0);
    });

    it("snaps to nearest frame at 60fps", () => {
      expect(snapToFrameBoundary(0.0, 60)).toBe(0.0);
      expect(snapToFrameBoundary(0.008, 60)).toBe(0.0); // Closer to frame 0
      expect(snapToFrameBoundary(0.009, 60)).toBeCloseTo(0.0167, 4); // Closer to frame 1
    });

    it("handles non-round split times correctly", () => {
      // Bug case: split at 36.94123s at 30fps
      const splitTime = 36.94123;
      const snapped = snapToFrameBoundary(splitTime, 30);
      const frameIndex = Math.round(splitTime * 30);
      const expected = frameIndex / 30;
      expect(snapped).toBe(expected);

      // Verify it's a real frame boundary
      expect((snapped * 30) % 1).toBe(0);
    });

    it("produces consistent results for split coherence", () => {
      const time = 5.467;
      const frameRate = 30;

      const snapped = snapToFrameBoundary(time, frameRate);

      // Snapping same time twice should produce identical result
      expect(snapToFrameBoundary(time, frameRate)).toBe(snapped);

      // Frame index should be integer
      expect(getFrameIndex(snapped, frameRate) % 1).toBe(0);
    });
  });

  describe("snapToFrameFloor", () => {
    it("snaps to previous frame boundary", () => {
      expect(snapToFrameFloor(0.016, 30)).toBe(0.0);
      expect(snapToFrameFloor(0.05, 30)).toBeCloseTo(0.0333, 4);
      expect(snapToFrameFloor(1.0, 30)).toBe(1.0);
    });

    it("never exceeds input time", () => {
      const time = 5.467;
      const floored = snapToFrameFloor(time, 30);
      expect(floored).toBeLessThanOrEqual(time);
    });
  });

  describe("snapToFrameCeil", () => {
    it("snaps to next frame boundary", () => {
      expect(snapToFrameCeil(0.016, 30)).toBeCloseTo(0.0333, 4);
      expect(snapToFrameCeil(0.05, 30)).toBeCloseTo(0.0667, 4);
      expect(snapToFrameCeil(1.0, 30)).toBe(1.0);
    });

    it("never goes below input time", () => {
      const time = 5.467;
      const ceiled = snapToFrameCeil(time, 30);
      expect(ceiled).toBeGreaterThanOrEqual(time);
    });
  });

  describe("getFrameIndex and getTimeFromFrame", () => {
    it("converts time to frame index correctly", () => {
      expect(getFrameIndex(0.0, 30)).toBe(0);
      expect(getFrameIndex(1.0, 30)).toBe(30);
      expect(getFrameIndex(0.5, 30)).toBe(15);
    });

    it("converts frame index to time correctly", () => {
      expect(getTimeFromFrame(0, 30)).toBe(0.0);
      expect(getTimeFromFrame(30, 30)).toBe(1.0);
      expect(getTimeFromFrame(15, 30)).toBe(0.5);
    });

    it("round-trips correctly", () => {
      const time = 5.467;
      const frameRate = 30;

      const frameIndex = getFrameIndex(time, frameRate);
      const backToTime = getTimeFromFrame(frameIndex, frameRate);

      expect(backToTime).toBeCloseTo(snapToFrameBoundary(time, frameRate), 4);
    });
  });

  describe("getFrameIndexAtTime", () => {
    it("uses half-open frame intervals", () => {
      expect(getFrameIndexAtTime(0, 30)).toBe(0);
      expect(getFrameIndexAtTime(0.0001, 30)).toBe(0);
      expect(getFrameIndexAtTime(1 / 30, 30)).toBe(1);
      expect(getFrameIndexAtTime((2 / 30) - 0.0001, 30)).toBe(1);
      expect(getFrameIndexAtTime(2 / 30, 30)).toBe(2);
    });

    it("does not turn a floating-point boundary into the previous frame", () => {
      expect(getFrameIndexAtTime(0.9999999999999999 / 30, 30)).toBe(1);
    });

    it("clamps invalid and negative times to frame zero", () => {
      expect(getFrameIndexAtTime(-1, 30)).toBe(0);
      expect(getFrameIndexAtTime(Number.NaN, 30)).toBe(0);
      expect(getFrameIndexAtTime(1, 0)).toBe(0);
    });

    it("returns the canonical frame start time", () => {
      expect(getFrameStartTime(0.05, 30)).toBeCloseTo(1 / 30, 8);
      expect(getFrameStartTime(1 / 30, 30)).toBeCloseTo(1 / 30, 8);
    });
  });

  describe("edge cases", () => {
    it("handles zero time", () => {
      expect(snapToFrameBoundary(0, 30)).toBe(0);
      expect(snapToFrameFloor(0, 30)).toBe(0);
      expect(snapToFrameCeil(0, 30)).toBe(0);
    });

    it("handles very small times", () => {
      const tiny = 0.001;
      expect(snapToFrameBoundary(tiny, 30)).toBe(0);
      expect(snapToFrameFloor(tiny, 30)).toBe(0);
      expect(snapToFrameCeil(tiny, 30)).toBeCloseTo(0.0333, 4);
    });

    it("handles large times", () => {
      const large = 3600.5; // 1 hour + 0.5s
      const snapped = snapToFrameBoundary(large, 30);
      expect(getFrameIndex(snapped, 30) % 1).toBe(0);
    });

    it("maintains precision across different frame rates", () => {
      const time = 10.5;

      [24, 30, 60, 120].forEach((fps) => {
        const snapped = snapToFrameBoundary(time, fps);
        const frameIndex = getFrameIndex(snapped, fps);
        expect(frameIndex % 1).toBe(0);
      });
    });
  });
});
