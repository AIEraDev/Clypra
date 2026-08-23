import { describe, it, expect, vi, beforeEach } from "vitest";
import { projectThumbnailService } from "../ProjectThumbnailService";
import type { Clip, Project } from "@/types";

describe("ProjectThumbnailService", () => {
  beforeEach(() => {
    projectThumbnailService.reset();
    vi.clearAllMocks();
  });

  describe("resolvePosterTimestamp", () => {
    it("returns 0.0 when clips array is empty", () => {
      expect(projectThumbnailService.resolvePosterTimestamp([])).toBe(0.0);
    });

    it("returns 0.0 when a visual clip starts at 0.0", () => {
      const clips = [
        { id: "c1", kind: "video", startTime: 0.0, duration: 5.0 } as Clip,
      ];
      expect(projectThumbnailService.resolvePosterTimestamp(clips)).toBe(0.0);
    });

    it("returns the earliest visual clip start time when leading gap exists", () => {
      const clips = [
        { id: "c1", kind: "video", startTime: 4.5, duration: 3.0 } as Clip,
        { id: "c2", kind: "image", startTime: 8.0, duration: 2.0 } as Clip,
      ];
      expect(projectThumbnailService.resolvePosterTimestamp(clips)).toBe(4.5);
    });

    it("ignores audio-only clips when finding the earliest visual frame", () => {
      const clips = [
        { id: "a1", kind: "audio", startTime: 1.0, duration: 10.0 } as Clip,
        { id: "v1", kind: "video", startTime: 6.2, duration: 4.0 } as Clip,
      ];
      expect(projectThumbnailService.resolvePosterTimestamp(clips)).toBe(6.2);
    });

    it("returns 0.0 if there are only audio clips", () => {
      const clips = [
        { id: "a1", kind: "audio", startTime: 2.0, duration: 10.0 } as Clip,
      ];
      expect(projectThumbnailService.resolvePosterTimestamp(clips)).toBe(0.0);
    });
  });

  describe("requestThumbnailUpdate revision and throttling", () => {
    const mockProject: Project = {
      id: "project-123",
      name: "Test Project",
      createdAt: 1000,
      updatedAt: 1000,
      aspectRatio: "16:9",
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 10,
      timelineSchemaVersion: 1,
    };

    it("skips generation when revision key (projectId:epoch) matches", () => {
      const generateSpy = vi.spyOn(projectThumbnailService, "generateThumbnail").mockResolvedValue("data:image/jpeg;base64,mock");

      // First request at epoch 1
      projectThumbnailService.requestThumbnailUpdate(mockProject, { tracks: [], clips: [], epoch: 1 });
      expect(generateSpy).toHaveBeenCalledTimes(1);

      // Second request with same epoch 1 -> skipped
      projectThumbnailService.requestThumbnailUpdate(mockProject, { tracks: [], clips: [], epoch: 1 });
      expect(generateSpy).toHaveBeenCalledTimes(1);

      // Third request with epoch 2 (force=true to bypass autoSave throttle if needed)
      projectThumbnailService.requestThumbnailUpdate(mockProject, { tracks: [], clips: [], epoch: 2 }, { force: true });
      expect(generateSpy).toHaveBeenCalledTimes(2);
    });

    it("throttles rapid auto-save thumbnail requests within the 10s window", () => {
      const generateSpy = vi.spyOn(projectThumbnailService, "generateThumbnail").mockResolvedValue("data:image/jpeg;base64,mock");

      // First auto-save request
      projectThumbnailService.requestThumbnailUpdate(mockProject, { tracks: [], clips: [], epoch: 1 }, { isAutoSave: true });
      expect(generateSpy).toHaveBeenCalledTimes(1);

      // Rapid subsequent auto-save request with changed epoch -> throttled
      projectThumbnailService.requestThumbnailUpdate(mockProject, { tracks: [], clips: [], epoch: 2 }, { isAutoSave: true });
      expect(generateSpy).toHaveBeenCalledTimes(1);

      // Explicit non-autosave / forced request -> bypasses throttle
      projectThumbnailService.requestThumbnailUpdate(mockProject, { tracks: [], clips: [], epoch: 3 }, { force: true });
      expect(generateSpy).toHaveBeenCalledTimes(2);
    });
  });
});
