import { describe, it, expect, vi, beforeEach } from "vitest";
import { NativeAnimatedStickerRenderer } from "../nativeStickerPreview";
import type { EvaluatedMediaLayer } from "@/core/evaluation/types";

// Mock Tauri path APIs
vi.mock("@tauri-apps/api/path", () => ({
  appCacheDir: vi.fn().mockResolvedValue("/mock-cache"),
  join: vi.fn((...args: string[]) => args.join("/")),
}));

// Mock stickers store and cache
vi.mock("@/features/stickers/store/stickersStore", () => ({
  useStickersStore: {
    getState: () => ({
      getCachedSticker: vi.fn().mockReturnValue({
        localAnimationPath: "stickers/test-lottie.json",
      }),
      initializeCache: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@/features/stickers/cache/stickerCache", () => ({
  stickerCacheManager: {
    readLottieJson: vi.fn().mockResolvedValue({
      v: "5.5.0",
      fr: 30,
      ip: 0,
      op: 60,
      w: 200,
      h: 200,
      layers: [],
    }),
  },
}));

// Mock lottie-web
const mockAnimation = {
  frameRate: 30,
  totalFrames: 60,
  goToAndStop: vi.fn(),
  destroy: vi.fn(),
};

vi.mock("lottie-web", () => ({
  default: {
    loadAnimation: vi.fn((config: any) => {
      // Mock canvas element created inside container
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 200;
      const ctx = {
        getImageData: vi.fn().mockReturnValue({
          data: new Uint8ClampedArray(200 * 200 * 4).fill(255),
        }),
      };
      vi.spyOn(canvas, "getContext").mockReturnValue(ctx as any);
      config.container.appendChild(canvas);
      return mockAnimation;
    }),
  },
}));

describe("NativeAnimatedStickerRenderer — GPU Frame Residency & Fast-Path", () => {
  let renderer: NativeAnimatedStickerRenderer;
  let sampleLayer: EvaluatedMediaLayer;

  beforeEach(() => {
    vi.clearAllMocks();
    renderer = new NativeAnimatedStickerRenderer();

    sampleLayer = {
      layerId: "sticker-layer-1",
      clipId: "clip-st-1",
      role: "overlay",
      clipKind: "sticker",
      zIndex: 1,
      trackIndex: 1,
      layerType: "media",
      mediaId: "sticker-heart",
      mediaType: "image",
      sourcePath: "/cache/stickers/heart.png",
      sourceTime: 0.5, // at 30 fps = frame 15
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
      inTransition: false,
      blendMode: "normal",
      stickerFormat: "lottie",
      stickerSourceId: "heart",
      stickerSettings: {
        speed: 1.0,
        loop: true,
      },
    };
  });

  it("returns null if the layer is not a lottie sticker", async () => {
    const staticLayer: EvaluatedMediaLayer = {
      ...sampleLayer,
      stickerFormat: "static",
    };
    const result = await renderer.render(staticLayer);
    expect(result).toBeNull();
  });

  it("generates full rgba on initial frame render and registers assetId", async () => {
    const result = await renderer.render(sampleLayer);
    expect(result).not.toBeNull();
    expect(result?.assetId).toBe("native-sticker:sticker-layer-1:15:200x200");
    expect(result?.rgba).toBeDefined();
    expect(result?.rgba.length).toBe(200 * 200 * 4);
    expect(mockAnimation.goToAndStop).toHaveBeenCalledWith(15, true);
  });

  it("skips canvas rasterization and returns empty rgba on repeated frame hit", async () => {
    // First render populates GPU frame residency cache
    const firstResult = await renderer.render(sampleLayer);
    expect(firstResult?.rgba.length).toBeGreaterThan(0);

    vi.clearAllMocks();

    // Second render for the same frame should hit the fast-path
    const secondResult = await renderer.render(sampleLayer);
    expect(secondResult).not.toBeNull();
    expect(secondResult?.assetId).toBe("native-sticker:sticker-layer-1:15:200x200");
    expect(secondResult?.rgba).toEqual([]); // Omitted payload because it's already on the GPU!
    expect(mockAnimation.goToAndStop).not.toHaveBeenCalled();
  });

  it("clears cached frames on dispose", async () => {
    await renderer.render(sampleLayer);
    renderer.dispose();
    expect(mockAnimation.destroy).toHaveBeenCalled();

    vi.clearAllMocks();
    // After dispose, it should re-rasterize because cache was wiped
    const postDisposeResult = await renderer.render(sampleLayer);
    expect(postDisposeResult?.rgba.length).toBeGreaterThan(0);
  });
});
