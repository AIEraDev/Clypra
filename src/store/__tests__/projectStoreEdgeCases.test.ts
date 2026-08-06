import { describe, it, expect, beforeEach, vi } from "vitest";
import fc from "fast-check";
import { useProjectStore } from "../projectStore";
import { useTimelineStore } from "../timelineStore";
import type { Project, MediaAsset } from "@/types";

describe("projectStore Edge Cases & Sanitization", () => {
  beforeEach(() => {
    useProjectStore.setState({
      project: null,
      mediaAssets: [],
      recentProjects: [],
      toastMessage: null,
      toastVariant: "success",
    });
    useTimelineStore.setState({
      tracks: [],
      clips: [],
      gaps: [],
      transitions: [],
      markers: [],
    });
  });

  describe("Project Name Sanitization", () => {
    it("sanitizes empty or whitespace-only project names to default 'Untitled Project'", async () => {
      const store = useProjectStore.getState();
      await store.createProject("   ", "16:9", 30);
      expect(useProjectStore.getState().project?.name).toBe("Untitled Project");
    });

    it("truncates project names longer than MAX_PROJECT_NAME_LENGTH using grapheme clusters", async () => {
      const extremelyLongName = "A".repeat(300);
      const store = useProjectStore.getState();
      await store.createProject(extremelyLongName, "16:9", 30);
      const createdName = useProjectStore.getState().project?.name;
      expect(createdName).toBeDefined();
      expect(createdName!.length).toBeLessThanOrEqual(100);
    });

    it("handles complex unicode and emoji project names correctly", async () => {
      const emojiName = "🎬 Clypra Video Editor Project 🚀✨";
      const store = useProjectStore.getState();
      await store.createProject(emojiName, "16:9", 30);
      expect(useProjectStore.getState().project?.name).toBe(emojiName);
    });
  });

  describe("Aspect Ratio & Frame Rate Settings", () => {
    it("sets correct resolution dimensions for various aspect ratios", async () => {
      const ratios = [
        { ratio: "16:9", w: 1920, h: 1080 },
        { ratio: "9:16", w: 1080, h: 1920 },
        { ratio: "1:1", w: 1080, h: 1080 },
        { ratio: "4:3", w: 1440, h: 1080 },
        { ratio: "21:9", w: 2520, h: 1080 },
      ];

      for (const { ratio, w, h } of ratios) {
        await useProjectStore.getState().createProject(`Test-${ratio}`, ratio, 60);
        const p = useProjectStore.getState().project;
        expect(p?.aspectRatio).toBe(ratio);
        expect(p?.canvasWidth).toBe(w);
        expect(p?.canvasHeight).toBe(h);
        expect(p?.frameRate).toBe(60);
      }
    });
  });

  describe("Media Asset Management", () => {
    it("allows adding unique media assets and removing by ID", () => {
      const store = useProjectStore.getState();
      const asset1: MediaAsset = {
        id: "asset-1",
        name: "test.mp4",
        path: "/path/to/test.mp4",
        type: "video",
        duration: 12.5,
      };
      const asset2: MediaAsset = {
        id: "asset-2",
        name: "audio.mp3",
        path: "/path/to/audio.mp3",
        type: "audio",
        duration: 45.0,
      };

      store.addMediaAsset(asset1);
      store.addMediaAsset(asset2);
      expect(useProjectStore.getState().mediaAssets.length).toBe(2);

      store.removeMediaAsset("asset-1");
      expect(useProjectStore.getState().mediaAssets.length).toBe(1);
      expect(useProjectStore.getState().mediaAssets[0].id).toBe("asset-2");
    });
  });

  describe("Toast Notifications", () => {
    it("shows toast and auto-dismisses after specified duration", async () => {
      vi.useFakeTimers();
      const store = useProjectStore.getState();
      store.showToast("Test Warning Toast", "warning", 1000);

      expect(useProjectStore.getState().toastMessage).toBe("Test Warning Toast");
      expect(useProjectStore.getState().toastVariant).toBe("warning");

      vi.advanceTimersByTime(1050);
      expect(useProjectStore.getState().toastMessage).toBeNull();
      vi.useRealTimers();
    });
  });

  describe("Concurrent Project Load Mutex", () => {
    it("handles multiple concurrent loadProject calls gracefully without state corruption", async () => {
      const proj1: Project = {
        id: "proj-1",
        name: "Project One",
        aspectRatio: "16:9",
        width: 1920,
        height: 1080,
        frameRate: 30,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const proj2: Project = {
        id: "proj-2",
        name: "Project Two",
        aspectRatio: "9:16",
        width: 1080,
        height: 1920,
        frameRate: 60,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Trigger concurrent project loads
      const p1 = useProjectStore.getState().loadProject(proj1, { tracks: [] });
      const p2 = useProjectStore.getState().loadProject(proj2, { tracks: [] });

      await Promise.all([p1, p2]);

      // The final state should be the second project loaded
      expect(useProjectStore.getState().project?.id).toBe("proj-2");
    });
  });
});
