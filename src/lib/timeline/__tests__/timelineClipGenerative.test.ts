import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getClipVisibleDuration, normalizeClipTiming, getClipEndTime, getTimelineContentEnd, getTimelineCanvasDuration, createClipFromAsset } from "../timelineClip";
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

  // ─── Regression: CLY-BUG-AUDIO-WAVEFORM ─────────────────────────────────────
  // createClipFromAsset must always set audioPath on audio clips so that
  // useWaveformData receives a non-empty path.  Before the fix, the guard
  // `audioPath && asset.type === "audio"` silently dropped the field when the
  // caller omitted audioPath, leaving VolumeWaveform with an empty string and
  // rendering a blank canvas.
  describe("createClipFromAsset — audio clip audioPath regression (CLY-BUG-AUDIO-WAVEFORM)", () => {
    const baseAudioAsset: MediaAsset = {
      id: "asset-audio-1",
      name: "Heavy urban traffic.wav",
      path: "/Users/Test/Music/Heavy urban traffic.wav",
      type: "audio",
      duration: 286,
      size: 82_000_000,
    };

    it("sets audioPath from asset.path when no explicit audioPath is given (file-drop / MediaTab drag path)", () => {
      const clip = createClipFromAsset({
        asset: baseAudioAsset,
        trackId: "track-1",
        startTime: 0,
        width: 1920,
        height: 1080,
      });
      // audioPath must be non-empty so VolumeWaveform can render the waveform
      expect((clip as any).audioPath).toBe(baseAudioAsset.path);
      expect((clip as any).audioPath).not.toBe("");
    });

    it("prefers an explicit audioPath over asset.path when provided", () => {
      const explicitPath = "/Library/explicit/path.wav";
      const clip = createClipFromAsset({
        asset: baseAudioAsset,
        trackId: "track-1",
        startTime: 0,
        width: 1920,
        height: 1080,
        audioPath: explicitPath,
      });
      expect((clip as any).audioPath).toBe(explicitPath);
    });

    it("does NOT set audioPath on video clips", () => {
      const videoAsset: MediaAsset = {
        id: "asset-video-1",
        name: "clip.mp4",
        path: "/path/clip.mp4",
        type: "video",
        duration: 10,
        size: 1024,
        width: 1920,
        height: 1080,
      };
      const clip = createClipFromAsset({
        asset: videoAsset,
        trackId: "track-1",
        startTime: 0,
        width: 1920,
        height: 1080,
      });
      // Video clips should not carry a top-level audioPath (audio is nested in clip.audio)
      expect((clip as any).audioPath).toBeUndefined();
    });

    it("does NOT set audioPath on image clips", () => {
      const imageAsset: MediaAsset = {
        id: "asset-image-1",
        name: "photo.jpg",
        path: "/path/photo.jpg",
        type: "image",
        duration: 5,
        size: 2048,
        width: 4000,
        height: 3000,
      };
      const clip = createClipFromAsset({
        asset: imageAsset,
        trackId: "track-1",
        startTime: 0,
        width: 1920,
        height: 1080,
      });
      expect((clip as any).audioPath).toBeUndefined();
    });

    it("audioPath is always a non-empty string for any audio asset with a non-empty path", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
          fc.float({ min: 1, max: 3600, noNaN: true }),
          (assetPath, duration) => {
            const asset: MediaAsset = {
              id: "asset-audio-gen",
              name: "audio.wav",
              path: assetPath,
              type: "audio",
              duration,
              size: 1000,
            };
            const clip = createClipFromAsset({
              asset,
              trackId: "t1",
              startTime: 0,
              width: 1920,
              height: 1080,
            });
            expect(typeof (clip as any).audioPath).toBe("string");
            expect((clip as any).audioPath.length).toBeGreaterThan(0);
          }
        )
      );
    });
  });
});
