import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getClipVisibleDuration, normalizeClipTiming, getClipEndTime, getTimelineContentEnd, getTimelineCanvasDuration } from "../timelineClip";
import type { Clip, MediaAsset } from "@/types";

describe("timelineClip Invariants & Generative Tests", () => {
  describe("getClipVisibleDuration", () => {
    it("never returns negative duration even if trimIn > trimOut", () => {
      fc.assert(
        fc.property(
          fc.double({ noNaN: true }),
          fc.double({ noNaN: true }),
          (trimIn, trimOut) => {
            const duration = getClipVisibleDuration({ trimIn, trimOut });
            expect(duration).toBeGreaterThanOrEqual(0);
            expect(Number.isNaN(duration)).toBe(false);
          }
        )
      );
    });

    it("handles undefined or NaN trim values safely", () => {
      expect(getClipVisibleDuration({ trimIn: NaN, trimOut: 10 })).toBe(10);
      expect(getClipVisibleDuration({ trimIn: undefined as any, trimOut: undefined as any })).toBe(0);
    });
  });

  describe("normalizeClipTiming", () => {
    it("guarantees trimIn <= trimOut and trimOut <= sourceDuration", () => {
      fc.assert(
        fc.property(
          fc.double({ min: -50, max: 500, noNaN: true }),
          fc.double({ min: -50, max: 500, noNaN: true }),
          fc.double({ min: -50, max: 500, noNaN: true }),
          fc.double({ min: 1, max: 300, noNaN: true }),
          (startTime, trimIn, trimOut, assetDuration) => {
            const mockClip: Clip = {
              id: "c1",
              trackId: "t1",
              mediaId: "a1",
              name: "Test",
              kind: "video",
              startTime,
              duration: 10,
              trimIn,
              trimOut,
              x: 0,
              y: 0,
              width: 1920,
              height: 1080,
              opacity: 1,
              rotation: 0,
            };
            const mockAsset: MediaAsset = {
              id: "a1",
              name: "Asset",
              path: "/path",
              type: "video",
              duration: assetDuration,
              size: 1024,
            };


            const normalized = normalizeClipTiming(mockClip, mockAsset);

            expect(normalized.trimIn).toBeGreaterThanOrEqual(0);
            expect(normalized.trimOut).toBeGreaterThanOrEqual(normalized.trimIn);
            expect(normalized.trimOut).toBeLessThanOrEqual(assetDuration);
            expect(normalized.duration).toBe(normalized.trimOut - normalized.trimIn);
          }
        )
      );
    });
  });

  describe("getTimelineCanvasDuration", () => {
    it("always returns at least TIMELINE_MIN_CANVAS_DURATION_SECONDS (5s)", () => {
      fc.assert(
        fc.property(fc.double({ noNaN: true }), (sequenceDuration) => {
          const canvasDuration = getTimelineCanvasDuration(sequenceDuration);
          expect(canvasDuration).toBeGreaterThanOrEqual(5);
          expect(Number.isNaN(canvasDuration)).toBe(false);
        })
      );
    });
  });

  describe("getTimelineContentEnd", () => {
    it("calculates the maximum clip end time correctly", () => {
      const clips = [
        { startTime: 0, trimIn: 0, trimOut: 5 },
        { startTime: 10, trimIn: 0, trimOut: 15 },
        { startTime: 5, trimIn: 2, trimOut: 8 },
      ];
      expect(getTimelineContentEnd(clips)).toBe(25);
    });

    it("returns 0 for empty clip list", () => {
      expect(getTimelineContentEnd([])).toBe(0);
    });
  });
});
