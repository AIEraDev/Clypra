import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToFrameSequence, renderFrameSequenceToTauri } from "../FrameRenderer";
import type { TextTemplate, TemplateCustomization } from "../types";

// Mock the package-owned canonical renderer facade.
vi.mock("@clypra-studio/engine", () => ({
  resolveTextTemplateArtifact: (input: any) => ({
    kind: "text-template",
    schemaVersion: 4,
    metadata: { id: input.id, label: input.label || input.name || input.id, category: input.category, tags: [] },
    document: { id: input.id, kind: "text-template", schemaVersion: 4, templateVersion: 1, canvas: { width: input.canvasWidth, height: input.canvasHeight }, nodes: [] },
    controls: [],
    timing: { duration: input.duration || input.defaultDuration || 0.1, fps: 30, durationPolicy: "fixed" },
    dependencies: { assets: [], fonts: [], textEffects: [] },
    revision: { revisionId: "test-revision", contentHash: "test-hash", schemaVersion: 4, rendererVersion: "1.5.0", createdAt: "2026-01-01" },
  }),
  renderTextTemplateToCanvas: vi.fn(),
}));

describe("Text Templates — Frame Renderer & Sequence Export Safety", () => {
  const mockTemplate: TextTemplate = {
    id: "tmpl-1",
    version: 1,
    displayName: "Cyber Motion",
    name: "Cyber Motion",
    label: "Cyber Motion",
    category: "title-card",
    thumbnail: "",
    preview: "",
    canvasWidth: 1920,
    canvasHeight: 1080,
    defaultDuration: 0.1,
    duration: 0.1, // 0.1s at 30fps = 3 frames
    elements: [],
    layers: [
      { id: "layer-1", kind: "text", role: "primary", content: "Original" } as any,
      { id: "primary-fill-layer", kind: "shape" } as any,
    ],
  };

  const mockCustomization: TemplateCustomization = {
    primaryText: "Custom Title",
    primaryColor: "#FF0000",
  };

  beforeEach(() => {
    // Mock HTMLCanvasElement.toBlob for jsdom testing
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (this: HTMLCanvasElement, callback: (blob: Blob | null) => void) {
      const mockBlob = new Blob(["mock-png-data"], { type: "image/png" });
      callback(mockBlob);
    });
  });

  // ─── 1. RENDER TO FRAME SEQUENCE ─────────────────────────────────────────
  describe("renderToFrameSequence", () => {
    it("should render frame sequence matching canvas dimensions and output frame rate", async () => {
      const progressTracker: number[] = [];

      const sequence = await renderToFrameSequence(
        mockTemplate,
        mockCustomization,
        (progress) => progressTracker.push(progress)
      );

      expect(sequence.width).toBe(1920);
      expect(sequence.height).toBe(1080);
      expect(sequence.fps).toBe(30);
      expect(sequence.frames.length).toBe(3); // 0.1s * 30fps = 3 frames
      expect(progressTracker[progressTracker.length - 1]).toBe(100);
    });
  });

  // ─── 2. RENDER FRAME SEQUENCE TO TAURI ───────────────────────────────────
  describe("renderFrameSequenceToTauri", () => {
    it("should generate 4-digit zero-padded frame file paths", async () => {
      const mockBlob = new Blob(["test"], { type: "image/png" });
      const sequence = {
        frames: [mockBlob, mockBlob, mockBlob],
        fps: 30,
        width: 1920,
        height: 1080,
        durationFrames: 3,
      };

      const paths = await renderFrameSequenceToTauri(sequence, "/output/dir");

      expect(paths).toEqual([
        "/output/dir/0000.png",
        "/output/dir/0001.png",
        "/output/dir/0002.png",
      ]);
    });

    it("should handle directory paths with trailing slashes gracefully", async () => {
      const mockBlob = new Blob(["test"], { type: "image/png" });
      const sequence = {
        frames: [mockBlob],
        fps: 30,
        width: 1920,
        height: 1080,
        durationFrames: 1,
      };

      const paths = await renderFrameSequenceToTauri(sequence, "/output/dir/");
      expect(paths[0]).toBe("/output/dir/0000.png");
    });
  });
});
