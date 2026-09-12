import { describe, it, expect, vi, beforeEach } from "vitest";
import { PLATFORM_PRESETS } from "../platformPresets";
import { compositeThumbnailCanvas } from "../thumbnailExport";
import { useProjectStore } from "@/store/projectStore";
import type { CreatorThumbnail, Project, ThumbnailOverlayLayer } from "@/types";

describe("Thumbnail Generator (Creator Thumbnails)", () => {
  describe("PLATFORM_PRESETS", () => {
    it("includes standard creator platform presets (YouTube, Shorts, TikTok, Instagram)", () => {
      const kinds = PLATFORM_PRESETS.map((p) => p.kind);
      expect(kinds).toContain("youtube");
      expect(kinds).toContain("shorts");
      expect(kinds).toContain("tiktok");
      expect(kinds).toContain("instagram");
    });

    it("has correct standard dimensions for YouTube (1280x720 16:9)", () => {
      const youtube = PLATFORM_PRESETS.find((p) => p.kind === "youtube");
      expect(youtube).toBeDefined();
      expect(youtube?.width).toBe(1280);
      expect(youtube?.height).toBe(720);
      expect(youtube?.aspectRatioLabel).toBe("16:9");
    });

    it("has correct standard vertical dimensions for Shorts and TikTok (1080x1920 9:16)", () => {
      const shorts = PLATFORM_PRESETS.find((p) => p.kind === "shorts");
      const tiktok = PLATFORM_PRESETS.find((p) => p.kind === "tiktok");
      expect(shorts?.width).toBe(1080);
      expect(shorts?.height).toBe(1920);
      expect(tiktok?.width).toBe(1080);
      expect(tiktok?.height).toBe(1920);
    });

    it("has correct 1:1 square dimensions for Instagram", () => {
      const ig = PLATFORM_PRESETS.find((p) => p.kind === "instagram");
      expect(ig?.width).toBe(1080);
      expect(ig?.height).toBe(1080);
      expect(ig?.aspectRatioLabel).toBe("1:1");
    });
  });

  describe("compositeThumbnailCanvas", () => {
    it("returns an HTMLCanvasElement with the requested target dimensions", () => {
      const canvas = compositeThumbnailCanvas(null, [], 1280, 720);
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(canvas.width).toBe(1280);
      expect(canvas.height).toBe(720);
    });

    it("composites text overlay layers without crashing", () => {
      const layers: ThumbnailOverlayLayer[] = [
        {
          id: "layer-1",
          kind: "text",
          text: "EPIC DROP",
          fontFamily: "Impact, sans-serif",
          fontSize: 80,
          fontWeight: "bold",
          color: "#ffffff",
          outlineColor: "#000000",
          outlineWidth: 8,
          shadowColor: "rgba(0,0,0,0.8)",
          shadowBlur: 10,
          x: 0.5,
          y: 0.8,
          opacity: 1,
          align: "center",
        },
        {
          id: "layer-2",
          kind: "badge",
          text: "NEW",
          fontFamily: "Inter, sans-serif",
          fontSize: 32,
          fontWeight: "bold",
          color: "#ffffff",
          backgroundColor: "#dc2626",
          backgroundPadding: 12,
          borderRadius: 6,
          x: 0.2,
          y: 0.2,
          opacity: 1,
          align: "center",
        },
      ];

      const canvas = compositeThumbnailCanvas(null, layers, 1080, 1920);
      expect(canvas.width).toBe(1080);
      expect(canvas.height).toBe(1920);
    });
  });

  describe("ProjectStore Creator Thumbnail Actions", () => {
    const mockProject: Project = {
      id: "proj-1",
      name: "Test Video",
      createdAt: 1000,
      updatedAt: 1000,
      aspectRatio: "16:9",
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 60,
    };

    beforeEach(() => {
      useProjectStore.setState({
        project: { ...mockProject, creatorThumbnails: [] },
      });
    });

    it("adds a new creator thumbnail variant to the project", () => {
      const sampleThumb: CreatorThumbnail = {
        id: "thumb-1",
        label: "YouTube Variant A",
        timestampMs: 5000,
        platformPreset: PLATFORM_PRESETS[0],
        overlayLayers: [],
        createdAt: 1000,
        updatedAt: 1000,
      };

      useProjectStore.getState().addCreatorThumbnail(sampleThumb);

      const state = useProjectStore.getState();
      expect(state.project?.creatorThumbnails).toHaveLength(1);
      expect(state.project?.creatorThumbnails?.[0].label).toBe("YouTube Variant A");
    });

    it("updates an existing creator thumbnail variant", () => {
      const sampleThumb: CreatorThumbnail = {
        id: "thumb-1",
        label: "Original Label",
        timestampMs: 5000,
        platformPreset: PLATFORM_PRESETS[0],
        overlayLayers: [],
        createdAt: 1000,
        updatedAt: 1000,
      };

      useProjectStore.getState().addCreatorThumbnail(sampleThumb);
      useProjectStore.getState().updateCreatorThumbnail("thumb-1", {
        label: "Updated Label",
        timestampMs: 12000,
      });

      const updated = useProjectStore.getState().project?.creatorThumbnails?.[0];
      expect(updated?.label).toBe("Updated Label");
      expect(updated?.timestampMs).toBe(12000);
    });

    it("removes a creator thumbnail variant by id", () => {
      const thumb1: CreatorThumbnail = {
        id: "thumb-1",
        label: "Variant 1",
        timestampMs: 1000,
        platformPreset: PLATFORM_PRESETS[0],
        overlayLayers: [],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const thumb2: CreatorThumbnail = {
        id: "thumb-2",
        label: "Variant 2",
        timestampMs: 2000,
        platformPreset: PLATFORM_PRESETS[1],
        overlayLayers: [],
        createdAt: 1000,
        updatedAt: 1000,
      };

      useProjectStore.getState().addCreatorThumbnail(thumb1);
      useProjectStore.getState().addCreatorThumbnail(thumb2);
      expect(useProjectStore.getState().project?.creatorThumbnails).toHaveLength(2);

      useProjectStore.getState().removeCreatorThumbnail("thumb-1");
      const remaining = useProjectStore.getState().project?.creatorThumbnails;
      expect(remaining).toHaveLength(1);
      expect(remaining?.[0].id).toBe("thumb-2");
    });
  });
});
