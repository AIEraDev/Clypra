/**
 * Gap Engine Tests
 *
 * Tests for gap detection, creation, manipulation, and validation logic.
 * Covers core functionality and edge cases.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { detectGaps, createGap, validateGap, insertGapWithRipple, removeGapWithRipple, resizeGap, packTrack, mergeAdjacentGaps, getTimelineItems } from "./gapEngine";
import type { Clip } from "@/types";
import type { Gap } from "@/types/gap";

// Helper to create test clips
const createClip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id,
  trackId,
  startTime,
  duration,
  mediaId: `media-${id}`,
  trimIn: 0,
  trimOut: duration,
  transform: { x: 0, y: 0, scale: 1, rotation: 0 },
  effects: [],
  volume: 1,
  speed: 1,
  locked: false,
} as any as Clip);

describe("gapEngine", () => {
  describe("detectGaps", () => {
    it("should detect gap between two clips", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 10, 5)];

      const gaps = detectGaps(clips);

      expect(gaps).toHaveLength(1);
      expect(gaps[0].startTime).toBe(5);
      expect(gaps[0].duration).toBe(5);
      expect(gaps[0].trackId).toBe("track1");
    });

    it("should detect gap at start before first clip", () => {
      const clips = [createClip("clip1", "track1", 5, 5)];

      const gaps = detectGaps(clips);

      expect(gaps).toHaveLength(1);
      expect(gaps[0].startTime).toBe(0);
      expect(gaps[0].duration).toBe(5);
    });

    it("should detect multiple gaps on same track", () => {
      const clips = [createClip("clip1", "track1", 0, 2), createClip("clip2", "track1", 5, 2), createClip("clip3", "track1", 10, 2)];

      const gaps = detectGaps(clips);

      expect(gaps).toHaveLength(2);
      expect(gaps[0].startTime).toBe(2);
      expect(gaps[0].duration).toBe(3);
      expect(gaps[1].startTime).toBe(7);
      expect(gaps[1].duration).toBe(3);
    });

    it("should return empty array when no gaps exist", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 5, 5)];

      const gaps = detectGaps(clips);

      expect(gaps).toHaveLength(0);
    });

    it("should return empty array when no clips exist", () => {
      const gaps = detectGaps([]);
      expect(gaps).toHaveLength(0);
    });

    it("should not recreate existing gaps (preserveExisting)", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 10, 5)];

      const existingGap = createGap({
        trackId: "track1",
        startTime: 5,
        duration: 5,
        type: "manual",
        source: "user-insert",
        protected: true,
      });

      const gaps = detectGaps(clips, [existingGap]);

      expect(gaps).toHaveLength(0); // Should not recreate
    });

    it("should handle floating point precision correctly", () => {
      const clips = [
        createClip("clip1", "track1", 0, 1.5),
        createClip("clip2", "track1", 1.50001, 2), // Very small gap (within epsilon)
      ];

      const gaps = detectGaps(clips);

      expect(gaps).toHaveLength(0); // Should ignore tiny floating point gaps
    });

    it("should sort clips before detecting gaps", () => {
      const clips = [
        createClip("clip2", "track1", 10, 5),
        createClip("clip1", "track1", 0, 5), // Unordered
      ];

      const gaps = detectGaps(clips);

      expect(gaps).toHaveLength(1);
      expect(gaps[0].startTime).toBe(5);
      expect(gaps[0].duration).toBe(5);
    });
  });

  describe("createGap", () => {
    it("should create a gap with all properties", () => {
      const gap = createGap({
        trackId: "track1",
        startTime: 5,
        duration: 3,
        type: "manual",
        source: "user-insert",
        protected: true,
        metadata: { note: "Important gap" },
      });

      expect(gap.id).toMatch(/^gap-/);
      expect(gap.trackId).toBe("track1");
      expect(gap.startTime).toBe(5);
      expect(gap.duration).toBe(3);
      expect(gap.type).toBe("manual");
      expect(gap.source).toBe("user-insert");
      expect(gap.protected).toBe(true);
      expect(gap.metadata?.note).toBe("Important gap");
    });

    it("should auto-protect manual gaps", () => {
      const gap = createGap({
        trackId: "track1",
        startTime: 0,
        duration: 2,
        type: "manual",
        source: "user-insert",
      });

      expect(gap.protected).toBe(true);
    });

    it("should not auto-protect auto gaps", () => {
      const gap = createGap({
        trackId: "track1",
        startTime: 0,
        duration: 2,
        type: "auto",
        source: "clip-drag",
      });

      expect(gap.protected).toBe(false);
    });
  });

  describe("validateGap", () => {
    it("should validate gap with no conflicts", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 10, 5)];

      const validation = validateGap({ trackId: "track1", startTime: 5, duration: 5 }, clips);

      expect(validation.valid).toBe(true);
      expect(validation.conflicts).toBeUndefined();
    });

    it("should detect overlap with single clip", () => {
      const clips = [createClip("clip1", "track1", 5, 5)];

      const validation = validateGap(
        { trackId: "track1", startTime: 7, duration: 5 }, // Overlaps clip1
        clips,
      );

      expect(validation.valid).toBe(false);
      expect(validation.conflicts).toHaveLength(1);
      expect(validation.conflicts![0].clipId).toBe("clip1");
    });

    it("should detect overlap with multiple clips", () => {
      const clips = [createClip("clip1", "track1", 5, 3), createClip("clip2", "track1", 10, 3)];

      const validation = validateGap(
        { trackId: "track1", startTime: 7, duration: 8 }, // Overlaps both
        clips,
      );

      expect(validation.valid).toBe(false);
      expect(validation.conflicts).toHaveLength(2);
    });

    it("should not flag clips on different tracks", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track2", 7, 5)];

      const validation = validateGap({ trackId: "track1", startTime: 7, duration: 5 }, clips);

      expect(validation.valid).toBe(true); // track2 clip shouldn't matter, track1 clip ends at 5
    });

    it("should handle edge-touching clips (no overlap)", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 10, 5)];

      const validation = validateGap(
        { trackId: "track1", startTime: 5, duration: 5 }, // Exactly between clips
        clips,
      );

      expect(validation.valid).toBe(true);
    });
  });

  describe("insertGapWithRipple", () => {
    it("should insert gap and identify affected clips", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 5, 5), createClip("clip3", "track1", 10, 5)];

      const result = insertGapWithRipple("track1", 7, 3, clips);

      expect(result.success).toBe(true);
      expect(result.gap).toBeDefined();
      expect(result.gap!.startTime).toBe(7);
      expect(result.gap!.duration).toBe(3);
      expect(result.affectedClipIds).toEqual(["clip3"]); // Only clip3 starts at/after 7s
    });

    it("should reject zero duration", () => {
      const result = insertGapWithRipple("track1", 5, 0, []);

      expect(result.success).toBe(false);
      expect(result.error).toContain("positive");
    });

    it("should reject negative duration", () => {
      const result = insertGapWithRipple("track1", 5, -2, []);

      expect(result.success).toBe(false);
      expect(result.error).toContain("positive");
    });

    it("should reject negative start time", () => {
      const result = insertGapWithRipple("track1", -1, 2, []);

      expect(result.success).toBe(false);
      expect(result.error).toContain("negative");
    });

    it("should insert at start affecting all clips", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 5, 5)];

      const result = insertGapWithRipple("track1", 0, 2, clips);

      expect(result.success).toBe(true);
      expect(result.affectedClipIds).toEqual(["clip1", "clip2"]);
    });

    it("should insert at end affecting no clips", () => {
      const clips = [createClip("clip1", "track1", 0, 5)];

      const result = insertGapWithRipple("track1", 10, 2, clips);

      expect(result.success).toBe(true);
      expect(result.affectedClipIds).toEqual([]);
    });
  });

  describe("removeGapWithRipple", () => {
    it("should remove gap and identify affected clips", () => {
      const gap = createGap({
        trackId: "track1",
        startTime: 5,
        duration: 3,
        type: "manual",
        source: "user-insert",
      });

      const clips = [
        createClip("clip1", "track1", 0, 5),
        createClip("clip2", "track1", 8, 5), // After gap
        createClip("clip3", "track1", 13, 5), // After gap
      ];

      const result = removeGapWithRipple(gap, clips);

      expect(result.success).toBe(true);
      expect(result.affectedClipIds).toEqual(["clip2", "clip3"]);
    });

    it("should handle gap at end with no affected clips", () => {
      const gap = createGap({
        trackId: "track1",
        startTime: 10,
        duration: 5,
        type: "auto",
        source: "clip-drag",
      });

      const clips = [createClip("clip1", "track1", 0, 5)];

      const result = removeGapWithRipple(gap, clips);

      expect(result.success).toBe(true);
      expect(result.affectedClipIds).toEqual([]);
    });
  });

  describe("resizeGap", () => {
    let gap: Gap;

    beforeEach(() => {
      gap = createGap({
        trackId: "track1",
        startTime: 5,
        duration: 3,
        type: "manual",
        source: "user-insert",
      });
    });

    it("should resize gap and identify affected clips", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 8, 5)];

      const result = resizeGap(gap, 5, clips); // Increase by 2 seconds

      expect(result.success).toBe(true);
      expect(result.gap!.duration).toBe(5);
      expect(result.affectedClipIds).toEqual(["clip2"]);
    });

    it("should reject zero duration", () => {
      const result = resizeGap(gap, 0, []);

      expect(result.success).toBe(false);
      expect(result.error).toContain("positive");
    });

    it("should reject negative duration", () => {
      const result = resizeGap(gap, -2, []);

      expect(result.success).toBe(false);
      expect(result.error).toContain("positive");
    });

    it("should handle shrinking gap (negative delta)", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 8, 5)];

      const result = resizeGap(gap, 1, clips); // Decrease by 2 seconds

      expect(result.success).toBe(true);
      expect(result.gap!.duration).toBe(1);
      expect(result.affectedClipIds).toEqual(["clip2"]);
    });
  });

  describe("getTimelineItems", () => {
    it("should return clips and gaps in chronological order", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 10, 5)];

      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 5,
          duration: 5,
          type: "auto",
          source: "clip-drag",
        }),
      ];

      const items = getTimelineItems(clips, gaps, "track1");

      expect(items).toHaveLength(3);
      expect(items[0].type).toBe("clip");
      expect(items[0].startTime).toBe(0);
      expect(items[1].type).toBe("gap");
      expect(items[1].startTime).toBe(5);
      expect(items[2].type).toBe("clip");
      expect(items[2].startTime).toBe(10);
    });

    it("should filter by track ID", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track2", 0, 5)];

      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 5,
          duration: 2,
          type: "auto",
          source: "clip-drag",
        }),
      ];

      const items = getTimelineItems(clips, gaps, "track1");

      expect(items).toHaveLength(2); // Only track1 items
      expect(
        items.every((item) => {
          if (item.type === "clip") return item.item.trackId === "track1";
          return item.item.trackId === "track1";
        }),
      ).toBe(true);
    });

    it("should calculate end times correctly", () => {
      const clips = [createClip("clip1", "track1", 0, 5)];
      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 5,
          duration: 3,
          type: "auto",
          source: "clip-drag",
        }),
      ];

      const items = getTimelineItems(clips, gaps, "track1");

      expect(items[0].endTime).toBe(5);
      expect(items[1].endTime).toBe(8);
    });
  });

  describe("mergeAdjacentGaps", () => {
    it("should merge two adjacent gaps", () => {
      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 0,
          duration: 2,
          type: "auto",
          source: "clip-drag",
        }),
        createGap({
          trackId: "track1",
          startTime: 2,
          duration: 3,
          type: "auto",
          source: "clip-drag",
        }),
      ];

      const merged = mergeAdjacentGaps(gaps);

      expect(merged).toHaveLength(1);
      expect(merged[0].startTime).toBe(0);
      expect(merged[0].duration).toBe(5);
    });

    it("should merge overlapping gaps", () => {
      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 0,
          duration: 3,
          type: "auto",
          source: "clip-drag",
        }),
        createGap({
          trackId: "track1",
          startTime: 2,
          duration: 3,
          type: "auto",
          source: "clip-drag",
        }),
      ];

      const merged = mergeAdjacentGaps(gaps);

      expect(merged).toHaveLength(1);
      expect(merged[0].startTime).toBe(0);
      expect(merged[0].duration).toBe(5);
    });

    it("should preserve protected status when merging", () => {
      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 0,
          duration: 2,
          type: "protected", // Use protected type
          source: "user-insert",
          protected: true,
        }),
        createGap({
          trackId: "track1",
          startTime: 2,
          duration: 2,
          type: "auto",
          source: "clip-drag",
          protected: false,
        }),
      ];

      const merged = mergeAdjacentGaps(gaps);

      expect(merged).toHaveLength(1);
      expect(merged[0].protected).toBe(true); // Should inherit protection
      expect(merged[0].type).toBe("protected");
    });

    it("should not merge non-adjacent gaps", () => {
      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 0,
          duration: 2,
          type: "auto",
          source: "clip-drag",
        }),
        createGap({
          trackId: "track1",
          startTime: 5,
          duration: 2,
          type: "auto",
          source: "clip-drag",
        }),
      ];

      const merged = mergeAdjacentGaps(gaps);

      expect(merged).toHaveLength(2); // Should remain separate
    });

    it("should return single gap unchanged", () => {
      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 0,
          duration: 2,
          type: "auto",
          source: "clip-drag",
        }),
      ];

      const merged = mergeAdjacentGaps(gaps);

      expect(merged).toHaveLength(1);
      expect(merged[0]).toEqual(gaps[0]);
    });

    it("should return empty array for empty input", () => {
      const merged = mergeAdjacentGaps([]);
      expect(merged).toHaveLength(0);
    });

    it("should handle floating point precision in adjacency check", () => {
      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 0,
          duration: 1.5,
          type: "auto",
          source: "clip-drag",
        }),
        createGap({
          trackId: "track1",
          startTime: 1.50001, // Very close (within epsilon)
          duration: 2,
          type: "auto",
          source: "clip-drag",
        }),
      ];

      const merged = mergeAdjacentGaps(gaps);

      expect(merged).toHaveLength(1); // Should merge despite tiny gap
    });
  });

  describe("packTrack", () => {
    it("should remove all unprotected gaps", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 10, 5)];

      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 5,
          duration: 5,
          type: "auto",
          source: "clip-drag",
          protected: false,
        }),
      ];

      const result = packTrack("track1", clips, gaps);

      expect(result.remainingGaps).toHaveLength(0);
      expect(result.affectedClipIds).toEqual(["clip1", "clip2"]);
    });

    it("should preserve protected gaps", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 10, 5)];

      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 5,
          duration: 5,
          type: "manual",
          source: "user-insert",
          protected: true,
        }),
      ];

      const result = packTrack("track1", clips, gaps);

      expect(result.remainingGaps).toHaveLength(1);
      expect(result.remainingGaps[0].id).toBe(gaps[0].id);
    });

    it("should handle mixed protected and unprotected gaps", () => {
      const clips = [createClip("clip1", "track1", 0, 5)];

      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 5,
          duration: 2,
          type: "auto",
          source: "clip-drag",
          protected: false,
        }),
        createGap({
          trackId: "track1",
          startTime: 7,
          duration: 2,
          type: "manual",
          source: "user-insert",
          protected: true,
        }),
        createGap({
          trackId: "track1",
          startTime: 9,
          duration: 2,
          type: "auto",
          source: "clip-drag",
          protected: false,
        }),
      ];

      const result = packTrack("track1", clips, gaps);

      expect(result.remainingGaps).toHaveLength(1);
      expect(result.remainingGaps[0].protected).toBe(true);
    });

    it("should handle track with no gaps", () => {
      const clips = [createClip("clip1", "track1", 0, 5)];
      const gaps: Gap[] = [];

      const result = packTrack("track1", clips, gaps);

      expect(result.remainingGaps).toHaveLength(0);
      expect(result.affectedClipIds).toEqual(["clip1"]);
    });

    it("should only affect clips on target track", () => {
      const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track2", 0, 5)];

      const gaps = [
        createGap({
          trackId: "track1",
          startTime: 5,
          duration: 2,
          type: "auto",
          source: "clip-drag",
        }),
      ];

      const result = packTrack("track1", clips, gaps);

      expect(result.affectedClipIds).toEqual(["clip1"]);
      expect(result.affectedClipIds).not.toContain("clip2");
    });
  });

  describe("Edge Cases", () => {
    describe("Floating Point Precision", () => {
      it("should handle very small durations", () => {
        const result = insertGapWithRipple("track1", 0, 0.001, []);
        expect(result.success).toBe(true);
        expect(result.gap!.duration).toBe(0.001);
      });

      it("should handle very large time values", () => {
        const clips = [createClip("clip1", "track1", 3600, 60)]; // 1 hour in

        const result = insertGapWithRipple("track1", 3650, 10, clips);
        expect(result.success).toBe(true);
      });

      it("should handle fractional frame durations", () => {
        // At 30fps, one frame = 0.0333... seconds
        const result = insertGapWithRipple("track1", 0, 1 / 30, []);
        expect(result.success).toBe(true);
      });
    });

    describe("Empty Tracks", () => {
      it("should detect no gaps on empty track", () => {
        const gaps = detectGaps([]);
        expect(gaps).toHaveLength(0);
      });

      it("should insert gap on empty track", () => {
        const result = insertGapWithRipple("track1", 0, 2, []);
        expect(result.success).toBe(true);
        expect(result.affectedClipIds).toEqual([]);
      });

      it("should pack empty track", () => {
        const result = packTrack("track1", [], []);
        expect(result.remainingGaps).toHaveLength(0);
        expect(result.affectedClipIds).toEqual([]);
      });
    });

    describe("Single Clip Tracks", () => {
      it("should detect gap before single clip", () => {
        const clips = [createClip("clip1", "track1", 5, 5)];
        const gaps = detectGaps(clips);

        expect(gaps).toHaveLength(1);
        expect(gaps[0].startTime).toBe(0);
      });

      it("should insert gap after single clip", () => {
        const clips = [createClip("clip1", "track1", 0, 5)];
        const result = insertGapWithRipple("track1", 10, 2, clips);

        expect(result.success).toBe(true);
        expect(result.affectedClipIds).toEqual([]);
      });
    });

    describe("Tight Packing (No Gaps)", () => {
      it("should detect no gaps when clips are perfectly adjacent", () => {
        const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 5, 5), createClip("clip3", "track1", 10, 5)];

        const gaps = detectGaps(clips);
        expect(gaps).toHaveLength(0);
      });

      it("should pack track that's already tight", () => {
        const clips = [createClip("clip1", "track1", 0, 5), createClip("clip2", "track1", 5, 5)];

        const result = packTrack("track1", clips, []);

        expect(result.remainingGaps).toHaveLength(0);
        expect(result.affectedClipIds).toHaveLength(2);
      });
    });

    describe("Zero-Length Gaps", () => {
      it("should reject zero-length gap insertion", () => {
        const result = insertGapWithRipple("track1", 0, 0, []);
        expect(result.success).toBe(false);
      });

      it("should reject zero-length gap resize", () => {
        const gap = createGap({
          trackId: "track1",
          startTime: 0,
          duration: 2,
          type: "auto",
          source: "clip-drag",
        });

        const result = resizeGap(gap, 0, []);
        expect(result.success).toBe(false);
      });
    });

    describe("Boundary Conditions", () => {
      it("should handle gap exactly at timeline start (0)", () => {
        const result = insertGapWithRipple("track1", 0, 2, []);
        expect(result.success).toBe(true);
        expect(result.gap!.startTime).toBe(0);
      });

      it("should reject negative start time", () => {
        const result = insertGapWithRipple("track1", -1, 2, []);
        expect(result.success).toBe(false);
      });

      it("should handle very large start times", () => {
        const result = insertGapWithRipple("track1", 1000000, 2, []);
        expect(result.success).toBe(true);
      });
    });
  });
});
