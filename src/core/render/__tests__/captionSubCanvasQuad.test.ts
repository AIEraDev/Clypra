/**
 * Caption Sub-Canvas Quad & Snapshot Placement Tests
 *
 * NOTE: This test covers the geometry and snapshot metadata emitted by
 * NativeRasterBridge (NativeRasterLayerSnapshot). Real physical wgpu GPU compositor
 * quad placement and Metal vertex buffer translation on screen remain unverified
 * until a manual runtime check on an M1/Metal display session.
 *
 * Verifies that:
 * 1. Sub-canvas raster layers (e.g. 400×100 bounding box) are correctly registered
 *    with texture dimensions matching the bounding box rather than the full canvas.
 * 2. With positionMode: "absolute", the NativeRasterBridge preserves the offset (x, y)
 *    in the NativeRasterLayerSnapshot for the wgpu compositor.
 * 3. Compares sub-canvas texture upload size (160 KB) against full 1080p canvas (8.29 MB),
 *    confirming ~98% memory/bandwidth reduction per caption update.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatedScene, EvaluatedTextLayer } from "@/core/evaluation/types";

const mocks = vi.hoisted(() => ({
  register: vi.fn().mockResolvedValue(undefined),
  registerImage: vi.fn().mockResolvedValue(undefined),
  rasterizeText: vi.fn(),
  textKey: vi.fn(() => "caption-subcanvas-key"),
  traceTextRenderTiming: vi.fn(),
}));

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: () => true,
  registerNativeImageAsset: mocks.registerImage,
  registerNativeRasterAsset: mocks.register,
}));

vi.mock("@/components/editor/preview/nativeTextPreview", () => ({
  buildNativeTextRasterKey: mocks.textKey,
  rasterizeTextLayerForNative: mocks.rasterizeText,
}));

vi.mock("@/core/render/textRenderTrace", () => ({
  traceTextRenderTiming: mocks.traceTextRenderTiming,
}));

vi.mock("@/components/editor/preview/nativeStickerPreview", () => ({
  NativeAnimatedStickerRenderer: class {
    render = vi.fn().mockResolvedValue(null);
    dispose = vi.fn();
  },
}));

import { NativeRasterBridge } from "../nativeRasterBridge";

describe("Caption Sub-Canvas Quad Snapshot Placement (NativeRasterLayerSnapshot only; Metal compositor unverified)", () => {
  beforeEach(() => {
    mocks.register.mockClear();
    mocks.registerImage.mockReset();
    mocks.registerImage.mockResolvedValue(undefined);
    mocks.rasterizeText.mockReset();
    mocks.textKey.mockClear();
    mocks.traceTextRenderTiming.mockClear();
  });

  it("places a sub-canvas raster quad at a known offset with sub-canvas dimensions", async () => {
    // 1080p scene with a caption layer positioned near the bottom
    const scene: EvaluatedScene = {
      visualLayers: [
        {
          layerType: "text",
          layerId: "caption-layer-1",
          x: 760,
          y: 850,
          width: 400,
          height: 100,
          rotation: 0,
          opacity: 1,
          zIndex: 10,
        } as unknown as EvaluatedTextLayer,
      ],
      metadata: {
        canvasWidth: 1920,
        canvasHeight: 1080,
      },
    } as unknown as EvaluatedScene;

    // Simulate rasterizer returning a tight 400×100 sub-canvas RGBA buffer
    const subCanvasWidth = 400;
    const subCanvasHeight = 100;
    const subCanvasRgba = new Uint8ClampedArray(subCanvasWidth * subCanvasHeight * 4);

    mocks.rasterizeText.mockResolvedValue({
      assetId: "native-text:caption-layer-1:subcanvas-hash",
      rgba: subCanvasRgba,
      width: subCanvasWidth,
      height: subCanvasHeight,
      x: 760,
      y: 850,
      rotation: 0,
      opacity: 1,
      zIndex: 10,
      blendMode: "normal",
      positionMode: "absolute",
      isText: true,
    });

    const bridge = new NativeRasterBridge();
    const rasters = await bridge.rasterize(scene, { frameKey: 0 });

    expect(rasters).toHaveLength(1);
    const snapshot = rasters[0];

    // Texture dimensions must match sub-canvas bounding box, NOT full 1920×1080
    expect(snapshot.width).toBe(400);
    expect(snapshot.height).toBe(100);
    expect(snapshot.displayWidth).toBe(400);
    expect(snapshot.displayHeight).toBe(100);

    // Quad position in project space
    expect(snapshot.x).toBe(760);
    expect(snapshot.y).toBe(850);
    expect(snapshot.rotation).toBe(0);
    expect(snapshot.opacity).toBe(1);

    // Register call received the sub-canvas buffer and exact placement
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "native-text:caption-layer-1:subcanvas-hash",
        width: 400,
        height: 100,
        x: 760,
        y: 850,
      }),
    );

    // Upload size calculation:
    const subCanvasBytes = snapshot.width * snapshot.height * 4;
    const full1080pBytes = 1920 * 1080 * 4;
    expect(subCanvasBytes).toBe(160000); // 160 KB
    expect(full1080pBytes).toBe(8294400); // 8.29 MB
    const reductionRatio = (full1080pBytes - subCanvasBytes) / full1080pBytes;
    expect(reductionRatio).toBeGreaterThan(0.98); // > 98% savings

    bridge.dispose();
  });

  it("scales display dimensions proportionally when layer width/height differ from base", async () => {
    // Caption scaled to 1.5x (e.g. 600×150 displayed, 400×100 base)
    const scene: EvaluatedScene = {
      visualLayers: [
        {
          layerType: "text",
          layerId: "caption-layer-2",
          x: 660,
          y: 825,
          width: 600,
          height: 150,
          baseWidth: 400,
          baseHeight: 100,
          rotation: 0,
          opacity: 1,
          zIndex: 10,
        } as unknown as EvaluatedTextLayer,
      ],
      metadata: {
        canvasWidth: 1920,
        canvasHeight: 1080,
      },
    } as unknown as EvaluatedScene;

    mocks.rasterizeText.mockResolvedValue({
      assetId: "native-text:caption-layer-2:scaled-hash",
      rgba: new Uint8ClampedArray(400 * 100 * 4),
      width: 400,
      height: 100,
      x: 660,
      y: 825,
      rotation: 0,
      opacity: 1,
      zIndex: 10,
      blendMode: "normal",
      positionMode: "absolute",
      isText: true,
    });

    const bridge = new NativeRasterBridge();
    const rasters = await bridge.rasterize(scene, { frameKey: 1 });

    expect(rasters).toHaveLength(1);
    const snapshot = rasters[0];

    // Texture remains 400×100, but displayQuad scales to 600×150
    expect(snapshot.width).toBe(400);
    expect(snapshot.height).toBe(100);
    expect(snapshot.displayWidth).toBe(600);
    expect(snapshot.displayHeight).toBe(150);
    expect(snapshot.x).toBe(660);
    expect(snapshot.y).toBe(825);

    bridge.dispose();
  });
});
