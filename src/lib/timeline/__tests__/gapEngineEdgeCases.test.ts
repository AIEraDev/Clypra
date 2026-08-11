import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectGaps, createGap, validateGap, insertGapWithRipple, removeGapWithRipple, resizeGap, mergeAdjacentGaps, packTrack } from "../gapEngine";
import type { Clip, Track } from "@/types";
import type { Gap } from "@/types/gap";

describe("gapEngine Edge Cases & Property Invariants", () => {
  describe("detectGaps", () => {
    it("returns empty array when clips list is empty", () => {
      expect(detectGaps([])).toEqual([]);
    });

    it("detects initial gap when first clip starts after time 0", () => {
      const clips: Clip[] = [
        { id: "c1", trackId: "t1", mediaId: "m1", name: "C1", kind: "video", startTime: 3.5, duration: 5, trimIn: 0, trimOut: 5, x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
      ];
      const detected = detectGaps(clips);
      expect(detected.length).toBe(1);
      expect(detected[0].startTime).toBe(0);
      expect(detected[0].duration).toBe(3.5);
    });

    it("detects gaps between multiple non-overlapping clips on the same track", () => {
      const clips: Clip[] = [
        { id: "c1", trackId: "t1", mediaId: "m1", name: "C1", kind: "video", startTime: 0, duration: 5, trimIn: 0, trimOut: 5, x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
        { id: "c2", trackId: "t1", mediaId: "m1", name: "C2", kind: "video", startTime: 10, duration: 5, trimIn: 0, trimOut: 5, x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
      ];
      const detected = detectGaps(clips);
      expect(detected.length).toBe(1);
      expect(detected[0].startTime).toBe(5);
      expect(detected[0].duration).toBe(5);
    });

    it("property test: detectGaps never produces negative gap durations for arbitrary clip start times", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.uuid(),
              trackId: fc.constant("t1"),
              mediaId: fc.constant("m1"),
              name: fc.string(),
              kind: fc.constant<Clip["kind"]>("video"),
              startTime: fc.double({ min: 0, max: 200, noNaN: true }),
              duration: fc.double({ min: 0.1, max: 50, noNaN: true }),
              trimIn: fc.constant(0),
              trimOut: fc.constant(5),
              x: fc.constant(0),
              y: fc.constant(0),
              width: fc.constant(1920),
              height: fc.constant(1080),
              opacity: fc.constant(1),
              rotation: fc.constant(0),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (clips) => {
            const gaps = detectGaps(clips);
            gaps.forEach((gap) => {
              expect(gap.startTime).toBeGreaterThanOrEqual(0);
              expect(gap.duration).toBeGreaterThan(0);
              expect(Number.isFinite(gap.startTime)).toBe(true);
              expect(Number.isFinite(gap.duration)).toBe(true);
            });
          }
        )
      );
    });

  });

  describe("mergeAdjacentGaps", () => {
    it("returns original array if length <= 1", () => {
      expect(mergeAdjacentGaps([])).toEqual([]);
      const singleGap = [createGap({ trackId: "t1", startTime: 0, duration: 5, type: "auto", source: "unknown" })];
      expect(mergeAdjacentGaps(singleGap)).toEqual(singleGap);
    });

    it("merges adjacent gaps into a single continuous gap", () => {
      const gap1 = createGap({ trackId: "t1", startTime: 0, duration: 5, type: "auto", source: "unknown" });
      const gap2 = createGap({ trackId: "t1", startTime: 5, duration: 5, type: "auto", source: "unknown" });

      const merged = mergeAdjacentGaps([gap1, gap2]);
      expect(merged.length).toBe(1);
      expect(merged[0].startTime).toBe(0);
      expect(merged[0].duration).toBe(10);
    });
  });

  describe("insertGapWithRipple & resizeGap Input Validation", () => {
    it("rejects zero or negative duration when inserting gap", () => {
      const resultZero = insertGapWithRipple("t1", 5, 0, []);
      expect(resultZero.success).toBe(false);
      expect(resultZero.error).toBe("Gap duration must be positive");

      const resultNeg = insertGapWithRipple("t1", 5, -2, []);
      expect(resultNeg.success).toBe(false);
      expect(resultNeg.error).toBe("Gap duration must be positive");
    });

    it("rejects negative start time when inserting gap", () => {
      const result = insertGapWithRipple("t1", -5, 10, []);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Gap start time cannot be negative");
    });
  });
});
