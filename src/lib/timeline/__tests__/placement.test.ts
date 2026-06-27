import { describe, it, expect } from "vitest";
import { findSnap } from "../snapTargets";
import { 
  resolveDefaultFitModeForAsset, 
  resolveTargetTrackType, 
  resolvePreferredTrackId, 
  resolveClipStartTime, 
  resolveAddToTimelinePlacement 
} from "../placementPolicy";
import type { Clip, MediaAsset, Track } from "@/types";

describe("Timeline Placement & Snapping System", () => {
  
  describe("findSnap", () => {
    const trackClips: Clip[] = [
      { id: "clip-1", startTime: 1.0, duration: 2.0 } as Clip,
      { id: "clip-2", startTime: 5.0, duration: 3.0 } as Clip,
    ];

    it("should return snapped: false when snapping is disabled", () => {
      const result = findSnap({
        candidateTime: 1.05,
        trackClips,
        draggedClipIds: [],
        snapEnabled: false,
      });
      expect(result.snapped).toBe(false);
      expect(result.originalTime).toBe(1.05);
    });

    it("should snap to timeline start (0) when close enough", () => {
      const result = findSnap({
        candidateTime: 0.05,
        trackClips,
        draggedClipIds: [],
        snapEnabled: true,
        snapThresholdSeconds: 0.1,
      });
      expect(result.snapped).toBe(true);
      expect(result.snappedTime).toBe(0);
      expect(result.snapTarget!.type).toBe("timeline-start");
    });

    it("should snap to adjacent clip start edge when close enough", () => {
      const result = findSnap({
        candidateTime: 1.05,
        trackClips,
        draggedClipIds: ["clip-2"], // clip-2 is being dragged, so snap to clip-1
        snapEnabled: true,
        snapThresholdSeconds: 0.1,
      });
      expect(result.snapped).toBe(true);
      expect(result.snappedTime).toBe(1.0);
      expect(result.snapTarget!.type).toBe("clip-start");
    });

    it("should snap to adjacent clip end edge when close enough", () => {
      const result = findSnap({
        candidateTime: 3.05, // clip-1 ends at 3.0
        trackClips,
        draggedClipIds: [],
        snapEnabled: true,
        snapThresholdSeconds: 0.1,
      });
      expect(result.snapped).toBe(true);
      expect(result.snappedTime).toBe(3.0);
      expect(result.snapTarget!.type).toBe("clip-end");
    });

    it("should snap to playhead time when close enough", () => {
      const result = findSnap({
        candidateTime: 4.52,
        trackClips,
        draggedClipIds: [],
        snapEnabled: true,
        snapThresholdSeconds: 0.1,
        playheadTime: 4.5,
      });
      expect(result.snapped).toBe(true);
      expect(result.snappedTime).toBe(4.5);
      expect(result.snapTarget!.type).toBe("playhead");
    });
  });

  describe("resolveDefaultFitModeForAsset", () => {
    it("should resolve cover for video and contain for image", () => {
      expect(resolveDefaultFitModeForAsset({ type: "video" })).toBe("cover");
      expect(resolveDefaultFitModeForAsset({ type: "image" })).toBe("contain");
      expect(resolveDefaultFitModeForAsset({ type: "audio" })).toBe("cover"); // fallback
    });
  });

  describe("resolveTargetTrackType", () => {
    it("should resolve target type from asset classification or override", () => {
      expect(resolveTargetTrackType({ type: "video" })).toBe("video");
      expect(resolveTargetTrackType({ type: "audio" })).toBe("audio");
      expect(resolveTargetTrackType({ type: "video", trackType: "sticker" })).toBe("sticker");
      expect(resolveTargetTrackType({ type: "video", id: "sticker-123" })).toBe("sticker");
    });
  });

  describe("resolvePreferredTrackId", () => {
    const tracks: Track[] = [
      { id: "track-v1", type: "video", locked: false } as Track,
      { id: "track-v2", type: "video", locked: true } as Track,
      { id: "track-a1", type: "audio", locked: false } as Track,
    ];

    it("should return the first unlocked matching track when no preference is specified", () => {
      const result = resolvePreferredTrackId({ tracks, asset: { type: "video" } });
      expect(result).toBe("track-v1");
    });

    it("should honor preferences if the preferred track is matching and unlocked", () => {
      const result = resolvePreferredTrackId({ 
        tracks, 
        asset: { type: "video" }, 
        preferTrackId: "track-v1" 
      });
      expect(result).toBe("track-v1");
    });

    it("should ignore preferences and fallback if preferred track is locked", () => {
      const result = resolvePreferredTrackId({ 
        tracks, 
        asset: { type: "video" }, 
        preferTrackId: "track-v2" // Locked
      });
      expect(result).toBe("track-v1"); // fallbacks to unlocked
    });
  });

  describe("resolveClipStartTime", () => {
    const trackClips: Clip[] = [
      { id: "clip-1", startTime: 1.0, duration: 3.0 } as Clip, // ends at 4.0
    ];

    it("should resolve drop time when intent is drop", () => {
      expect(resolveClipStartTime({ intent: "drop", timelineEndTime: 10.0, dropTime: 2.5 })).toBe(2.5);
    });

    it("should resolve end of track when intent is track_end", () => {
      expect(resolveClipStartTime({ intent: "track_end", timelineEndTime: 10.0, trackClips })).toBe(4.0);
    });

    it("should resolve sequence end when intent is timeline_end", () => {
      expect(resolveClipStartTime({ intent: "timeline_end", timelineEndTime: 8.5 })).toBe(8.5);
    });
  });

  describe("resolveAddToTimelinePlacement", () => {
    const tracks: Track[] = [
      { id: "track-v1", type: "video", locked: false } as Track,
    ];
    const clips: Clip[] = [
      { id: "clip-1", trackId: "track-v1", startTime: 0, duration: 5.0 } as Clip,
    ];

    it("should resolve placement at playhead time and request a new track if target track is occupied", () => {
      const result = resolveAddToTimelinePlacement({
        asset: { type: "video" },
        tracks,
        clips,
        playheadTime: 2.0, // track-v1 is occupied between 0 and 5.0
        sequenceEndTime: 10.0,
      });

      expect(result.startTime).toBe(2.0);
      expect(result.shouldCreateTrack).toBe(true);
      expect(result.targetTrackId).toBeNull();
    });

    it("should resolve placement directly on preferred track if target track is free at playhead", () => {
      const result = resolveAddToTimelinePlacement({
        asset: { type: "video" },
        tracks,
        clips,
        playheadTime: 6.0, // track-v1 is free after 5.0
        sequenceEndTime: 10.0,
      });

      expect(result.startTime).toBe(6.0);
      expect(result.shouldCreateTrack).toBe(false);
      expect(result.targetTrackId).toBe("track-v1");
    });
  });
});
