import { describe, it, expect } from "vitest";
import { getClipVisibleDuration, getClipEndTime, getTimelineContentEnd, getTimelineViewportEnd, normalizeClipTiming, createClipFromAsset, resolveClipDuration } from "../timeline/timelineClip";
import { resolveDefaultFitModeForAsset } from "../timeline/placementPolicy";
import { timeToPixel, getTimelineLabelColumnWidth } from "../timeline/timelineViewport";
import type { Clip, MediaAsset } from "@/types";


describe("timelineClip timing helpers", () => {
  describe("getClipVisibleDuration", () => {
    it("calculates duration from trimIn and trimOut", () => {
      const clip = { trimIn: 2, trimOut: 7 };
      expect(getClipVisibleDuration(clip)).toBe(5);
    });

    it("returns 0 for negative duration", () => {
      const clip = { trimIn: 7, trimOut: 2 };
      expect(getClipVisibleDuration(clip)).toBe(0);
    });

    it("returns 0 when trimIn equals trimOut", () => {
      const clip = { trimIn: 5, trimOut: 5 };
      expect(getClipVisibleDuration(clip)).toBe(0);
    });
  });

  describe("getClipEndTime", () => {
    it("calculates end time from startTime and visible duration", () => {
      const clip = { startTime: 10, trimIn: 2, trimOut: 7 };
      expect(getClipEndTime(clip)).toBe(15); // 10 + (7 - 2)
    });

    it("handles clip at timeline start", () => {
      const clip = { startTime: 0, trimIn: 0, trimOut: 5 };
      expect(getClipEndTime(clip)).toBe(5);
    });
  });

  describe("getTimelineContentEnd", () => {
    it("returns 0 for empty clips array", () => {
      expect(getTimelineContentEnd([])).toBe(0);
    });

    it("returns the end time of a single clip", () => {
      const clips = [{ startTime: 5, trimIn: 0, trimOut: 10 }];
      expect(getTimelineContentEnd(clips)).toBe(15); // 5 + 10
    });

    it("returns the maximum end time for multiple clips", () => {
      const clips = [
        { startTime: 0, trimIn: 0, trimOut: 5 },
        { startTime: 5, trimIn: 0, trimOut: 10 },
        { startTime: 3, trimIn: 0, trimOut: 4 }, // ends at 7
      ];
      expect(getTimelineContentEnd(clips)).toBe(15); // max(5, 15, 7)
    });

    it("handles clips with trimming", () => {
      const clips = [
        { startTime: 0, trimIn: 2, trimOut: 8 }, // duration 6, ends at 6
        { startTime: 6, trimIn: 1, trimOut: 5 }, // duration 4, ends at 10
      ];
      expect(getTimelineContentEnd(clips)).toBe(10);
    });
  });

  describe("getTimelineViewportEnd", () => {
    it("returns minimum canvas duration (5s) for empty timeline", () => {
      expect(getTimelineViewportEnd(0)).toBe(5);
    });

    it("returns canvas duration for short content (4.365s + 2s)", () => {
      expect(getTimelineViewportEnd(4.365)).toBe(6.365);
    });

    it("returns 11s canvas duration for 9s content (2s padding)", () => {
      expect(getTimelineViewportEnd(9)).toBe(11);
    });

    it("returns canvas duration with 2s look-ahead padding for 25s content", () => {
      expect(getTimelineViewportEnd(25)).toBe(27);
    });
  });

  describe("normalizeClipTiming", () => {
    it("preserves valid clip timing", () => {
      const clip: Clip = {
        id: "clip-1",
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 0,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const asset: MediaAsset = {
        id: "media-1",
        name: "test.mp4",
        path: "/test.mp4",
        type: "video",
        duration: 10,
        width: 1920,
        height: 1080,
        size: 1000,
      };

      const normalized = normalizeClipTiming(clip, asset);
      expect(normalized.duration).toBe(5);
      expect(normalized.trimIn).toBe(0);
      expect(normalized.trimOut).toBe(5);
    });

    it("repairs duration from trimIn/trimOut", () => {
      const clip: Clip = {
        id: "clip-1",
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 0,
        duration: 999, // Wrong duration
        trimIn: 2,
        trimOut: 7,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const asset: MediaAsset = {
        id: "media-1",
        name: "test.mp4",
        path: "/test.mp4",
        type: "video",
        duration: 10,
        size: 1000,
      };

      const normalized = normalizeClipTiming(clip, asset);
      expect(normalized.duration).toBe(5); // Corrected to trimOut - trimIn
    });

    it("clamps trim bounds to source duration", () => {
      const clip: Clip = {
        id: "clip-1",
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 0,
        duration: 15,
        trimIn: 0,
        trimOut: 15, // Beyond source duration
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const asset: MediaAsset = {
        id: "media-1",
        name: "test.mp4",
        path: "/test.mp4",
        type: "video",
        duration: 10,
        size: 1000,
      };

      const normalized = normalizeClipTiming(clip, asset);
      expect(normalized.trimOut).toBe(10); // Clamped to source duration
      expect(normalized.duration).toBe(10);
    });

    it("handles negative trimIn", () => {
      const clip: Clip = {
        id: "clip-1",
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 0,
        duration: 5,
        trimIn: -2, // Invalid
        trimOut: 5,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const asset: MediaAsset = {
        id: "media-1",
        name: "test.mp4",
        path: "/test.mp4",
        type: "video",
        duration: 10,
        size: 1000,
      };

      const normalized = normalizeClipTiming(clip, asset);
      expect(normalized.trimIn).toBe(0); // Clamped to 0
      expect(normalized.duration).toBe(5);
    });

    it("works without asset (no clamping)", () => {
      const clip: Clip = {
        id: "clip-1",
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 0,
        duration: 999,
        trimIn: 5,
        trimOut: 15,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const normalized = normalizeClipTiming(clip);
      expect(normalized.duration).toBe(10); // trimOut - trimIn
      expect(normalized.trimIn).toBe(5);
      expect(normalized.trimOut).toBe(15);
    });
  });

  describe("createClipFromAsset", () => {
    it("creates a 10s clip from a 10s video asset", () => {
      const asset: MediaAsset = {
        id: "media-1",
        name: "test.mp4",
        path: "/test.mp4",
        type: "video",
        duration: 10,
        width: 1920,
        height: 1080,
        size: 1000,
      };

      const clip = createClipFromAsset({
        asset,
        trackId: "track-1",
        startTime: 0,
        width: 1920,
        height: 1080,
      });

      expect(clip.duration).toBe(10);
      expect(clip.trimIn).toBe(0);
      expect(clip.trimOut).toBe(10);
      expect(clip.duration).toBe(clip.trimOut - clip.trimIn);
    });

    it("creates a 4.365s clip from a 4.365s video asset", () => {
      const asset: MediaAsset = {
        id: "media-2",
        name: "short.mp4",
        path: "/short.mp4",
        type: "video",
        duration: 4.365,
        width: 1920,
        height: 1080,
        size: 500,
      };

      const clip = createClipFromAsset({
        asset,
        trackId: "track-1",
        startTime: 0,
        width: 1920,
        height: 1080,
      });

      expect(clip.duration).toBe(4.365);
      expect(clip.trimIn).toBe(0);
      expect(clip.trimOut).toBe(4.365);
      expect(clip.duration).toBe(clip.trimOut - clip.trimIn);
    });

    it("creates a clip with default duration for images", () => {
      const asset: MediaAsset = {
        id: "media-3",
        name: "image.jpg",
        path: "/image.jpg",
        type: "image",
        duration: 0,
        size: 200,
      };

      const clip = createClipFromAsset({
        asset,
        trackId: "track-1",
        startTime: 0,
        width: 1920,
        height: 1080,
      });

      // Should use DEFAULT_STILL_DURATION_SECONDS (typically 5)
      expect(clip.duration).toBeGreaterThan(0);
      expect(clip.trimIn).toBe(0);
      expect(clip.trimOut).toBe(clip.duration);
      expect(clip.duration).toBe(clip.trimOut - clip.trimIn);
    });

    it("uses cover as the default visual fit mode", () => {
      const asset: MediaAsset = {
        id: "media-cover-default",
        name: "portrait.mp4",
        path: "/portrait.mp4",
        type: "video",
        duration: 10,
        width: 1080,
        height: 1920,
        size: 1000,
      };

      const clip = createClipFromAsset({
        asset,
        trackId: "track-1",
        startTime: 0,
        width: 1920,
        height: 1080,
      });

      // Cover should fill width and overflow/crop height for portrait-in-landscape.
      expect(clip.width).toBe(1920);
      expect(clip.height).toBeGreaterThan(1080);
      expect(clip.x).toBe(0);
      expect(clip.y).toBeLessThan(0);
    });

    it("supports contain fit mode for full-media visibility", () => {
      const asset: MediaAsset = {
        id: "media-contain",
        name: "portrait.mp4",
        path: "/portrait.mp4",
        type: "video",
        duration: 10,
        width: 1080,
        height: 1920,
        size: 1000,
      };

      const clip = createClipFromAsset({
        asset,
        trackId: "track-1",
        startTime: 0,
        width: 1920,
        height: 1080,
        fitMode: "contain",
      });

      // Contain should fully fit inside the frame (pillarbox).
      expect(clip.height).toBe(1080);
      expect(clip.width).toBeLessThan(1920);
      expect(clip.y).toBe(0);
      expect(clip.x).toBeGreaterThan(0);
    });

    it("fits landscape image inside portrait canvas with contain (no crop)", () => {
      const asset: MediaAsset = {
        id: "landscape-image",
        name: "landscape.png",
        path: "/landscape.png",
        type: "image",
        duration: 0,
        width: 1920,
        height: 1080,
        size: 1000,
      };

      const clip = createClipFromAsset({
        asset,
        trackId: "track-1",
        startTime: 0,
        width: 1080, // 9:16 canvas
        height: 1920,
        fitMode: "contain",
      });

      // Contain in portrait: full width, reduced height, vertically centered.
      expect(clip.width).toBe(1080);
      expect(clip.height).toBeLessThan(1920);
      expect(clip.x).toBe(0);
      expect(clip.y).toBeGreaterThan(0);
    });
  });

  describe("timing invariant: duration === trimOut - trimIn", () => {
    it("maintains invariant for all clip operations", () => {
      const asset: MediaAsset = {
        id: "media-1",
        name: "test.mp4",
        path: "/test.mp4",
        type: "video",
        duration: 10,
        size: 1000,
      };

      const clip = createClipFromAsset({
        asset,
        trackId: "track-1",
        startTime: 0,
        width: 1920,
        height: 1080,
      });

      // Initial clip
      expect(clip.duration).toBe(clip.trimOut - clip.trimIn);

      // After normalization
      const normalized = normalizeClipTiming(clip, asset);
      expect(normalized.duration).toBe(normalized.trimOut - normalized.trimIn);

      // After trimming
      const trimmed = normalizeClipTiming({ ...clip, trimIn: 2, trimOut: 8, duration: 999 }, asset);
      expect(trimmed.duration).toBe(trimmed.trimOut - trimmed.trimIn);
      expect(trimmed.duration).toBe(6);
    });

    it("creates a sticker clip with stickerImagePath, stickerFormat, and name set correctly", () => {
      const asset: MediaAsset = {
        id: "sticker-123",
        name: "Joyful Laughing Face",
        path: "/path/to/sticker.png",
        type: "image",
        duration: 3.0,
        size: 0,
        stickerFormat: "lottie",
        stickerAnimationPath: "/path/to/sticker.json",
        stickerSourceId: "123",
        width: 400,
        height: 400,
      };

      const clip = createClipFromAsset({
        asset,
        trackId: "track-1",
        startTime: 5.0,
        width: 1920,
        height: 1080,
        fitMode: resolveDefaultFitModeForAsset(asset),
      });

      expect(clip.kind).toBe("sticker");
      expect(clip.mediaId).toBe("sticker-123");
      expect(clip.name).toBe("Joyful Laughing Face");
      expect((clip as any).stickerImagePath).toBe("/path/to/sticker.png");
      expect(clip.stickerFormat).toBe("lottie");
      expect(clip.stickerAnimationPath).toBe("/path/to/sticker.json");
      expect(clip.stickerSourceId).toBe("123");
      expect(clip.conform).toBeUndefined();
      expect(clip.width).toBe(400);
      expect(clip.height).toBe(400);
    });
  });

  describe("Clip right-edge & END marker pixel alignment regression tests", () => {

    const testCases = [
      { startTime: 4.365, duration: 9.633, pps: 45 },
      { startTime: 3.45, duration: 9.633, pps: 77 },
      { startTime: 2.45, duration: 12.1, pps: 77 },
      { startTime: 1.15, duration: 12.1, pps: 83 },
    ];


    testCases.forEach(({ startTime, duration, pps }) => {
      it(`aligns clip right edge to END marker for start=${startTime}s, dur=${duration}s at pps=${pps}`, () => {
        // New single-expression right edge position (derived from right edge)
        const leftPx = timeToPixel(startTime, pps);
        const rightPx = timeToPixel(startTime + duration, pps);
        const newClipWidthPx = rightPx - leftPx;
        const newClipRightEdgePx = leftPx + newClipWidthPx;

        // END marker position expression used by Timeline & TimelineRuler
        const endMarkerPositionPx = timeToPixel(startTime + duration, pps);

        // 1. Assert NEW clip right edge equals END marker position exactly
        expect(newClipRightEdgePx).toBe(endMarkerPositionPx);

        // Also check timeline lane column width offset inclusion
        const labelWidth = getTimelineLabelColumnWidth(true);
        expect(labelWidth + newClipRightEdgePx).toBe(labelWidth + endMarkerPositionPx);

        // 2. Demonstrate that OLD split implementation diverges (catches regression)
        const oldClipWidthPx = Math.round(duration * pps);
        const oldClipLeftPx = Math.round(startTime * pps);
        const oldClipRightEdgePx = oldClipLeftPx + oldClipWidthPx;

        // Confirm OLD implementation produces a 1px divergence on these non-integer test cases
        expect(oldClipRightEdgePx).not.toBe(endMarkerPositionPx);
        expect(Math.abs(oldClipRightEdgePx - endMarkerPositionPx)).toBe(1);
      });
    });
  });

  describe("Gap and Transition right-edge pixel alignment tests", () => {
    const testCases = [
      { startTime: 13.80, duration: 1.5, pps: 77 },
      { startTime: 4.365, duration: 9.633, pps: 45 },
      { startTime: 3.45, duration: 9.633, pps: 77 },
      { startTime: 1.15, duration: 12.1, pps: 83 },
    ];

    testCases.forEach(({ startTime, duration, pps }) => {
      it(`aligns Gap right edge to adjacent clip start position for start=${startTime}s, dur=${duration}s at pps=${pps}`, () => {
        const gapLeft = timeToPixel(startTime, pps);
        const gapRight = timeToPixel(startTime + duration, pps);
        const gapWidth = gapRight - gapLeft;
        const computedGapRight = gapLeft + gapWidth;

        const nextClipStartPx = timeToPixel(startTime + duration, pps);
        expect(computedGapRight).toBe(nextClipStartPx);

        // Verify OLD split formula fails against target
        const oldGapRight = Math.round(startTime * pps) + Math.round(duration * pps);
        expect(oldGapRight).not.toBe(nextClipStartPx);
        expect(Math.abs(oldGapRight - nextClipStartPx)).toBe(1);
      });

      it(`aligns Transition right edge to transition end position for start=${startTime}s, dur=${duration}s at pps=${pps}`, () => {
        const transLeft = timeToPixel(startTime, pps);
        const transRight = timeToPixel(startTime + duration, pps);
        const transWidth = transRight - transLeft;
        const computedTransRight = transLeft + transWidth;

        const expectedRightPx = timeToPixel(startTime + duration, pps);
        expect(computedTransRight).toBe(expectedRightPx);

        // Transition cutPoint verification: fromClip ends at cutPoint = startTime + duration/2
        const cutPoint = startTime + duration / 2;
        const toClipStartPx = timeToPixel(cutPoint, pps);
        const transitionEndTargetPx = timeToPixel(cutPoint + duration / 2, pps);
        expect(computedTransRight).toBe(transitionEndTargetPx);

        // Verify OLD split formula fails against target
        const oldTransRight = Math.round(startTime * pps) + Math.round(duration * pps);
        expect(oldTransRight).not.toBe(expectedRightPx);
        expect(Math.abs(oldTransRight - expectedRightPx)).toBe(1);
      });
    });
  });

});


