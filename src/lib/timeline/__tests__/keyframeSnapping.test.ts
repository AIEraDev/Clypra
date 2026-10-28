import { describe, expect, it } from "vitest";
import {
  collectTimelineKeyframes,
  findKeyframeSnap,
} from "../snapTargets";
import type { Clip } from "@/types";

describe("Keyframe Snapping System", () => {
  const createMockClip = (overrides: Partial<Clip> = {}): Clip => ({
    id: "clip-1",
    trackId: "track-1",
    mediaId: "media-1",
    name: "Test Clip",
    startTime: 2.0,
    duration: 5.0,
    trimIn: 0,
    trimOut: 5.0,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    ...overrides,
  });

  describe("collectTimelineKeyframes", () => {
    it("returns empty array when clips array is empty or clips have no keyframes", () => {
      expect(collectTimelineKeyframes([])).toEqual([]);
      expect(collectTimelineKeyframes([createMockClip()])).toEqual([]);
    });

    it("collects visual keyframes with absolute timeline timestamps (clip.startTime + kf.time)", () => {
      const clip = createMockClip({
        startTime: 3.0,
        duration: 10.0,
        visualKeyframes: {
          x: [
            { id: "k1", time: 1.0, value: 100 },
            { id: "k2", time: 4.0, value: 200 },
          ],
          rotation: [
            { id: "k3", time: 2.5, value: 45 },
          ],
        },
      });

      const candidates = collectTimelineKeyframes([clip]);
      expect(candidates).toHaveLength(3);
      // Absolute timeline times: 3.0 + 1.0 = 4.0, 3.0 + 2.5 = 5.5, 3.0 + 4.0 = 7.0
      expect(candidates.map((c) => c.time)).toEqual([4.0, 5.5, 7.0]);
      expect(candidates[0].clipId).toBe("clip-1");
      expect(candidates[0].propertyKey).toBe("x");
    });

    it("deduplicates compound milestones that share the same timestamp across properties", () => {
      const clip = createMockClip({
        startTime: 1.0,
        duration: 8.0,
        visualKeyframes: {
          x: [{ id: "kx", time: 2.0, value: 10 }],
          y: [{ id: "ky", time: 2.0, value: 20 }],
          width: [{ id: "kw", time: 2.0, value: 1920 }],
          height: [{ id: "kh", time: 2.0, value: 1080 }],
        },
      });

      const candidates = collectTimelineKeyframes([clip]);
      // Only 1 compound milestone candidate at absolute time 3.0s (1.0 + 2.0)
      expect(candidates).toHaveLength(1);
      expect(candidates[0].time).toBe(3.0);
    });

    it("collects audio volume keyframes properly", () => {
      const clip = createMockClip({
        startTime: 4.0,
        duration: 6.0,
        volumeKeyframes: [
          { id: "vk1", time: 0.5, gain: 0.8 },
          { id: "vk2", time: 3.0, gain: 1.2 },
        ],
      });

      const candidates = collectTimelineKeyframes([clip]);
      expect(candidates).toHaveLength(2);
      expect(candidates.map((c) => c.time)).toEqual([4.5, 7.0]);
      expect(candidates[0].propertyKey).toBe("volume");
    });

    it("filters out keyframes beyond clip duration or before 0", () => {
      const clip = createMockClip({
        startTime: 2.0,
        duration: 5.0,
        visualKeyframes: {
          opacity: [
            { id: "k-invalid-neg", time: -2.0, value: 0 },
            { id: "k-valid", time: 1.5, value: 0.5 },
            { id: "k-invalid-over", time: 12.0, value: 1 },
          ],
        },
      });

      const candidates = collectTimelineKeyframes([clip]);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].time).toBe(3.5); // 2.0 + 1.5
    });

    it("collects and sorts keyframes across multiple clips on different tracks", () => {
      const clipA = createMockClip({
        id: "clip-a",
        startTime: 1.0,
        duration: 4.0,
        visualKeyframes: {
          rotation: [{ id: "ka1", time: 1.0, value: 90 }], // abs: 2.0
        },
      });
      const clipB = createMockClip({
        id: "clip-b",
        startTime: 3.0,
        duration: 5.0,
        visualKeyframes: {
          x: [{ id: "kb1", time: 2.5, value: 50 }], // abs: 5.5
        },
      });

      const candidates = collectTimelineKeyframes([clipA, clipB]);
      expect(candidates).toHaveLength(2);
      expect(candidates[0].time).toBe(2.0);
      expect(candidates[0].clipId).toBe("clip-a");
      expect(candidates[1].time).toBe(5.5);
      expect(candidates[1].clipId).toBe("clip-b");
    });
  });

  describe("findKeyframeSnap", () => {
    const testClips: Clip[] = [
      createMockClip({
        id: "clip-1",
        startTime: 2.0,
        duration: 6.0,
        visualKeyframes: {
          rotation: [
            { id: "k1", time: 1.0, value: 45 },  // abs: 3.0s
            { id: "k2", time: 4.0, value: 180 }, // abs: 6.0s
          ],
        },
      }),
    ];

    it("returns snapped: false when snapEnabled is false", () => {
      // 3.01s is right next to 3.0s (within 8px at 100pps), but snapping is disabled
      const result = findKeyframeSnap({
        candidateTime: 3.01,
        clips: testClips,
        snapEnabled: false,
        pixelsPerSecond: 100,
      });

      expect(result.snapped).toBe(false);
      expect(result.originalTime).toBe(3.01);
      expect(result.snappedTime).toBeUndefined();
    });

    it("snaps magnetically to the exact center of the keyframe diamond when within 8px threshold", () => {
      // At 100 pps, 8px threshold is 0.08s
      // candidateTime 3.04s is 0.04s (4px) away from diamond at 3.0s
      const result = findKeyframeSnap({
        candidateTime: 3.04,
        clips: testClips,
        snapEnabled: true,
        pixelsPerSecond: 100,
      });

      expect(result.snapped).toBe(true);
      expect(result.originalTime).toBe(3.04);
      expect(result.snappedTime).toBe(3.0);
      expect(result.snapTarget).toEqual({
        clipId: "clip-1",
        time: 3.0,
        propertyKey: "rotation",
      });
    });

    it("does not snap when candidateTime is beyond the threshold distance", () => {
      // candidateTime 3.15s is 0.15s (15px) away from diamond at 3.0s (> 8px)
      const result = findKeyframeSnap({
        candidateTime: 3.15,
        clips: testClips,
        snapEnabled: true,
        pixelsPerSecond: 100,
      });

      expect(result.snapped).toBe(false);
      expect(result.originalTime).toBe(3.15);
      expect(result.snappedTime).toBeUndefined();
    });

    it("selects the closest keyframe diamond when multiple keyframes are nearby", () => {
      const multiClips: Clip[] = [
        createMockClip({
          id: "clip-dense",
          startTime: 0,
          duration: 10,
          visualKeyframes: {
            x: [
              { id: "k-early", time: 2.0, value: 0 },
              { id: "k-late", time: 2.05, value: 100 },
            ],
          },
        }),
      ];

      // candidateTime 2.04 is closer to 2.05 (dist 0.01) than 2.0 (dist 0.04)
      const result = findKeyframeSnap({
        candidateTime: 2.04,
        clips: multiClips,
        snapEnabled: true,
        pixelsPerSecond: 100,
      });

      expect(result.snapped).toBe(true);
      expect(result.snappedTime).toBe(2.05);
    });

    it("scales threshold accurately across different zoom levels", () => {
      // At zoom = 500 pps, 8px is 8 / 500 = 0.016s
      // A candidate at 3.02s is 0.02s away (10px), so beyond 8px threshold
      const beyondResult = findKeyframeSnap({
        candidateTime: 3.02,
        clips: testClips,
        snapEnabled: true,
        pixelsPerSecond: 500,
      });
      expect(beyondResult.snapped).toBe(false);

      // A candidate at 3.01s is 0.01s away (5px), so within 8px threshold
      const withinResult = findKeyframeSnap({
        candidateTime: 3.01,
        clips: testClips,
        snapEnabled: true,
        pixelsPerSecond: 500,
      });
      expect(withinResult.snapped).toBe(true);
      expect(withinResult.snappedTime).toBe(3.0);
    });
  });
});
