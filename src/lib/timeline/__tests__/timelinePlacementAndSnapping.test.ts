import { describe, it, expect, vi } from "vitest";
import { findSnap } from "../snapTargets";
import { autoAdaptSequenceForFirstVisualClip } from "../sequenceAutoAspect";
import type { Clip, MediaAsset, Project } from "@/types";

describe("Timeline Placement & Magnetic Snapping Engine", () => {
  const createMockClip = (id: string, startTime: number, duration: number): Clip => ({
    id,
    trackId: "track-1",
    mediaId: "media-1",
    startTime,
    duration,
    trimIn: 0,
    trimOut: duration,
    kind: "video",
    volume: 1,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
  });

  // ─── 1. MAGNETIC SNAPPING (findSnap) ─────────────────────────────────────
  describe("findSnap", () => {
    it("should return original candidate time if snap is disabled", () => {
      const result = findSnap({
        candidateTime: 5.03,
        trackClips: [],
        draggedClipIds: [],
        snapEnabled: false,
      });

      expect(result.snapped).toBe(false);
      expect(result.originalTime).toBe(5.03);
    });

    it("should snap to timeline start (0.0s) within threshold (e.g. 0.05s)", () => {
      const result = findSnap({
        candidateTime: 0.04,
        trackClips: [],
        draggedClipIds: [],
        snapEnabled: true,
        snapThresholdSeconds: 0.1,
      });

      expect(result.snapped).toBe(true);
      expect(result.snappedTime).toBe(0.0);
      expect(result.snapTarget?.type).toBe("timeline-start");
    });

    it("should snap to nearest clip start and end edges", () => {
      const clipA = createMockClip("clip-a", 10.0, 5.0); // 10s to 15s

      // Near clip start (10.02s) -> snap to 10s
      const snapStart = findSnap({
        candidateTime: 10.02,
        trackClips: [clipA],
        draggedClipIds: [],
        snapEnabled: true,
        snapThresholdSeconds: 0.1,
      });

      expect(snapStart.snapped).toBe(true);
      expect(snapStart.snappedTime).toBe(10.0);
      expect(snapStart.snapTarget?.type).toBe("clip-start");

      // Near clip end (14.98s) -> snap to 15s
      const snapEnd = findSnap({
        candidateTime: 14.98,
        trackClips: [clipA],
        draggedClipIds: [],
        snapEnabled: true,
        snapThresholdSeconds: 0.1,
      });

      expect(snapEnd.snapped).toBe(true);
      expect(snapEnd.snappedTime).toBe(15.0);
      expect(snapEnd.snapTarget?.type).toBe("clip-end");
    });

    it("should snap to playhead position when provided", () => {
      const result = findSnap({
        candidateTime: 7.46,
        trackClips: [],
        draggedClipIds: [],
        snapEnabled: true,
        snapThresholdSeconds: 0.1,
        playheadTime: 7.5,
      });

      expect(result.snapped).toBe(true);
      expect(result.snappedTime).toBe(7.5);
      expect(result.snapTarget?.type).toBe("playhead");
    });
  });

  // ─── 2. AUTO-ADAPT SEQUENCE ASPECT RATIO ────────────────────────────────
  describe("autoAdaptSequenceForFirstVisualClip", () => {
    it("should adapt project ratio to 9:16 when inserting vertical video into empty timeline", () => {
      const project: Project = {
        id: "proj-1",
        name: "Test Project",
        aspectRatio: "16:9",
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
        duration: 60,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const verticalAsset: MediaAsset = {
        id: "asset-vert",
        path: "/path/vert.mp4",
        name: "vert.mp4",
        type: "video",
        duration: 10,
        size: 1000,
        width: 1080,
        height: 1920,
      };

      const updateProjectSpy = vi.fn();

      autoAdaptSequenceForFirstVisualClip({
        project,
        existingClips: [],
        asset: verticalAsset,
        updateProject: updateProjectSpy,
      });

      expect(updateProjectSpy).toHaveBeenCalledWith({
        aspectRatio: "9:16",
        canvasWidth: 1080,
        canvasHeight: 1920,
      });
    });

    it("should NOT adapt project ratio if timeline already contains existing clips", () => {
      const project: Project = {
        id: "proj-1",
        name: "Test Project",
        aspectRatio: "16:9",
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
        duration: 60,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const existingClip = createMockClip("clip-1", 0, 5);
      const verticalAsset: MediaAsset = {
        id: "asset-vert",
        path: "/path/vert.mp4",
        name: "vert.mp4",
        type: "video",
        duration: 10,
        size: 1000,
        width: 1080,
        height: 1920,
      };

      const updateProjectSpy = vi.fn();

      autoAdaptSequenceForFirstVisualClip({
        project,
        existingClips: [existingClip],
        asset: verticalAsset,
        updateProject: updateProjectSpy,
      });

      expect(updateProjectSpy).not.toHaveBeenCalled();
    });
  });
});
