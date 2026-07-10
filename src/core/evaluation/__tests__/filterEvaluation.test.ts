import { describe, it, expect, vi } from "vitest";
import { evaluateTimelineScene } from "../evaluator";
import { getResourceCache } from "../../resources/ResourceCache";
import type { Clip, Track, MediaAsset, Project } from "@/types";

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
    this.width = width;
    this.height = height;
  }
}

class MockOffscreenCanvas {
  width: number;
  height: number;
  ctx: any;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ctx = {
      fillStyle: "",
      strokeStyle: "",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      filter: "none",
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      getImageData: vi.fn(() => new MockImageData(width, height)),
    };
  }
  getContext(type: string) {
    return type === "2d" ? this.ctx : null;
  }
  transferToImageBitmap() {
    return Promise.resolve({ width: this.width, height: this.height, close: vi.fn() });
  }
}

// @ts-ignore
globalThis.OffscreenCanvas = MockOffscreenCanvas;
// @ts-ignore
globalThis.ImageData = MockImageData;

// Simple stub for ImageBitmap in test environment
if (typeof ImageBitmap === "undefined") {
  // @ts-ignore
  globalThis.ImageBitmap = class ImageBitmap {};
}

describe("Filter Evaluation", () => {
  const project: Project = {
    id: "test-project",
    name: "Test",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    aspectRatio: "16:9",
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 10,
  };

  const tracks: Track[] = [
    { id: "t-video", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 56 },
    { id: "t-filter", type: "filter", name: "Filter", muted: false, locked: false, visible: true, height: 30 },
  ];

  const assets: MediaAsset[] = [{ id: "image-asset", name: "Image.jpg", path: "/path/to/image.jpg", type: "image", duration: 10, width: 1920, height: 1080, size: 1000000 }];

  it("applies filter to active visual layers", () => {
    const imageClip: Clip = {
      id: "clip-image",
      kind: "image",
      trackId: "t-video",
      mediaId: "image-asset",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1.0,
      rotation: 0,
    };

    const filterClip = {
      id: "clip-filter-1",
      kind: "filter",
      trackId: "t-filter",
      mediaId: "filter-sepia",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      opacity: 1.0,
      rotation: 0,
      name: "Sepia Tone",
      intensity: 0.8,
    } as any;

    const scene = evaluateTimelineScene(2.5, [imageClip, filterClip], tracks, assets, project);

    // Check if the visual layer for image has the filter applied from the filter track
    const imageLayer = scene.visualLayers.find((l) => l.clipId === "clip-image");
    expect(imageLayer).toBeDefined();
    expect(imageLayer?.layerType).toBe("media");
    // Filter from filter track is now applied to each media layer
    expect((imageLayer as any).filter).toEqual({
      id: "filter-sepia",
      name: "Sepia Tone",
      intensity: 0.8,
    });

    // Verify the track-level filter is correctly attached at the scene level
    expect(scene.activeFilter).toEqual({
      id: "filter-sepia",
      name: "Sepia Tone",
      intensity: 0.8,
    });
  });

  it("does not apply filters from hidden filter tracks", () => {
    const hiddenFilterTracks: Track[] = tracks.map((track) => (track.id === "t-filter" ? { ...track, visible: false } : track));
    const imageClip: Clip = {
      id: "clip-image",
      kind: "image",
      trackId: "t-video",
      mediaId: "image-asset",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1.0,
      rotation: 0,
    };
    const filterClip = {
      id: "clip-filter-1",
      kind: "filter",
      trackId: "t-filter",
      mediaId: "filter-sepia",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      opacity: 1.0,
      rotation: 0,
      name: "Sepia Tone",
      intensity: 0.8,
    } as any;

    const scene = evaluateTimelineScene(2.5, [imageClip, filterClip], hiddenFilterTracks, assets, project);

    expect(scene.activeFilter).toBeUndefined();
  });

  it("normalizes active filter intensity before rendering", () => {
    const imageClip: Clip = {
      id: "clip-image",
      kind: "image",
      trackId: "t-video",
      mediaId: "image-asset",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1.0,
      rotation: 0,
    };
    const filterClip = {
      id: "clip-filter-1",
      kind: "filter",
      trackId: "t-filter",
      mediaId: "filter-vivid",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      opacity: 1.0,
      rotation: 0,
      name: "Vivid",
      intensity: 2,
    } as any;

    const scene = evaluateTimelineScene(2.5, [imageClip, filterClip], tracks, assets, project);

    expect(scene.activeFilter).toEqual({
      id: "filter-vivid",
      name: "Vivid",
      intensity: 1,
    });
  });
});
