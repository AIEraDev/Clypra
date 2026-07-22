import { describe, it, expect } from "vitest";
import { getClipVisibleDuration, getClipEndTime, getTimelineContentEnd, getTimelineViewportEnd, normalizeClipTiming, createClipFromAsset, resolveClipDuration, isStickerClip, isFilterClip } from "../timeline/timelineClip";
import { resolveDefaultFitModeForAsset } from "../timeline/placementPolicy";
import type { Clip, MediaAsset } from "@/types";

describe("clip kind predicates", () => {
  it("identifies stickers by explicit kind or legacy media ID", () => {
    expect(isStickerClip({ kind: "sticker", mediaId: "media-1" })).toBe(true);
    expect(isStickerClip({ kind: "image", mediaId: "sticker-1" })).toBe(true);
    expect(isStickerClip({ kind: "image", mediaId: "media-1" })).toBe(false);
  });

  it("identifies filters by explicit kind or legacy clip ID", () => {
    expect(isFilterClip({ id: "clip-1", kind: "filter" })).toBe(true);
    expect(isFilterClip({ id: "filter-clip-1", kind: "video" })).toBe(true);
    expect(isFilterClip({ id: "clip-1", kind: "video" })).toBe(false);
  });
});

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
    it("returns at least 10 seconds for empty timeline", () => {
      expect(getTimelineViewportEnd(0)).toBe(10);
    });

    it("returns content end for short content", () => {
      expect(getTimelineViewportEnd(4.365)).toBe(4.365);
    });

    it("returns content end for content longer than 10s", () => {
      expect(getTimelineViewportEnd(25)).toBe(25);
    });

    it("returns exactly 10 for 10s content", () => {
      expect(getTimelineViewportEnd(10)).toBe(10);
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
});
