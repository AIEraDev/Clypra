import { describe, it, expect } from "vitest";
import { detectGaps, createGap, validateGap, insertGapWithRipple, removeGapWithRipple, resizeGap, mergeAdjacentGaps } from "../gapEngine";
import type { Clip } from "@/types";
import type { Gap } from "@/types/gap";

describe("Timeline Gap Engine", () => {
  
  describe("detectGaps", () => {
    it("should detect gaps at the start and between clips correctly", () => {
      const clips: Clip[] = [
        { id: "clip-1", trackId: "track-1", startTime: 1.0, duration: 2.0 } as Clip,
        { id: "clip-2", trackId: "track-1", startTime: 5.0, duration: 3.0 } as Clip,
      ];

      const gaps = detectGaps(clips);

      // We expect 2 gaps:
      // 1. Start gap: 0s to 1.0s (duration 1.0)
      // 2. Middle gap: 3.0s to 5.0s (duration 2.0)
      expect(gaps.length).toBe(2);
      
      expect(gaps[0].startTime).toBe(0);
      expect(gaps[0].duration).toBe(1.0);
      expect(gaps[0].type).toBe("auto");

      expect(gaps[1].startTime).toBe(3.0);
      expect(gaps[1].duration).toBe(2.0);
      expect(gaps[1].type).toBe("auto");
    });

    it("should return empty array if there are no clips", () => {
      expect(detectGaps([])).toEqual([]);
    });
  });

  describe("validateGap", () => {
    it("should mark valid if gap does not overlap with any clips", () => {
      const clips: Clip[] = [
        { id: "clip-1", trackId: "track-1", startTime: 1.0, duration: 2.0 } as Clip,
      ];

      const gap = { trackId: "track-1", startTime: 3.0, duration: 1.0 };
      const validation = validateGap(gap, clips);
      expect(validation.valid).toBe(true);
    });

    it("should mark invalid and return conflict details if gap overlaps with a clip", () => {
      const clips: Clip[] = [
        { id: "clip-1", trackId: "track-1", startTime: 1.0, duration: 2.0 } as Clip,
      ];

      const gap = { trackId: "track-1", startTime: 2.0, duration: 2.0 }; // Overlaps between 2.0 and 3.0
      const validation = validateGap(gap, clips);
      expect(validation.valid).toBe(false);
      expect(validation.conflicts!.length).toBe(1);
      expect(validation.conflicts![0].clipId).toBe("clip-1");
      expect(validation.conflicts![0].overlap).toEqual({ start: 2.0, end: 3.0 });
    });
  });

  describe("insertGapWithRipple", () => {
    it("should return affected clip IDs after insertion point to ripple them right", () => {
      const clips: Clip[] = [
        { id: "clip-1", trackId: "track-1", startTime: 1.0, duration: 2.0 } as Clip,
        { id: "clip-2", trackId: "track-1", startTime: 4.0, duration: 2.0 } as Clip,
      ];

      const result = insertGapWithRipple("track-1", 1.5, 1.0, clips);
      expect(result.success).toBe(true);
      expect(result.gap!.startTime).toBe(1.5);
      expect(result.gap!.duration).toBe(1.0);
      
      // clip-2 (starts at 4.0 >= 1.5) should be shifted.
      // clip-1 starts at 1.0 < 1.5, but wait! Does clip-1 overlap with insert point?
      // Yes, clip-1 ends at 3.0. But insertGapWithRipple only shifts clips whose startTime >= insert point.
      expect(result.affectedClipIds).toContain("clip-2");
      expect(result.affectedClipIds).not.toContain("clip-1");
    });

    it("should clamp shifting if a protected gap is encountered", () => {
      const clips: Clip[] = [
        { id: "clip-1", trackId: "track-1", startTime: 1.0 } as Clip,
        { id: "clip-2", trackId: "track-1", startTime: 4.0 } as Clip,
      ];

      const existingGaps: Gap[] = [
        { id: "gap-1", trackId: "track-1", startTime: 3.0, duration: 1.0, protected: true } as Gap,
      ];

      // Insert gap at 1.5. A protected gap exists at 3.0.
      // Only clips starting between 1.5 and 3.0 should be shifted.
      const result = insertGapWithRipple("track-1", 1.5, 1.0, clips, existingGaps);
      expect(result.affectedClipIds).not.toContain("clip-2"); // clip-2 is after the protected gap (4.0 >= 3.0)
    });
  });

  describe("removeGapWithRipple", () => {
    it("should return affected clip IDs to shift left on gap removal", () => {
      const clips: Clip[] = [
        { id: "clip-1", trackId: "track-1", startTime: 0 } as Clip,
        { id: "clip-2", trackId: "track-1", startTime: 5.0 } as Clip, // Starts after the gap ends
      ];

      const gap = { id: "gap-1", trackId: "track-1", startTime: 2.0, duration: 2.0 } as Gap;
      const result = removeGapWithRipple(gap, clips);

      expect(result.success).toBe(true);
      expect(result.affectedClipIds).toContain("clip-2");
    });
  });

  describe("resizeGap", () => {
    it("should allow resizing and compute delta affects", () => {
      const clips: Clip[] = [
        { id: "clip-1", trackId: "track-1", startTime: 5.0 } as Clip,
      ];

      const gap = { id: "gap-1", trackId: "track-1", startTime: 2.0, duration: 2.0 } as Gap;
      
      // Expand duration from 2.0 to 3.0 (+1.0 delta)
      const result = resizeGap(gap, 3.0, clips);
      expect(result.success).toBe(true);
      expect(result.gap!.duration).toBe(3.0);
      expect(result.affectedClipIds).toContain("clip-1");
    });
  });

  describe("mergeAdjacentGaps", () => {
    it("should merge overlapping or adjacent gaps", () => {
      const gaps: Gap[] = [
        { id: "gap-1", trackId: "track-1", startTime: 1.0, duration: 2.0, protected: false } as Gap,
        { id: "gap-2", trackId: "track-1", startTime: 3.0, duration: 1.0, protected: false } as Gap, // Adjacent (ends at 3.0 starts at 3.0)
        { id: "gap-3", trackId: "track-1", startTime: 5.0, duration: 1.0, protected: false } as Gap, // Far gap
      ];

      const merged = mergeAdjacentGaps(gaps);
      expect(merged.length).toBe(2);
      expect(merged[0].startTime).toBe(1.0);
      expect(merged[0].duration).toBe(3.0); // 2.0 + 1.0
      expect(merged[1].startTime).toBe(5.0);
    });
  });
});
