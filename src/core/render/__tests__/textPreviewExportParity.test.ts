import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EvaluatedScene, EvaluatedTextLayer } from "@/core/evaluation/types";

const { mockRegisterRaster } = vi.hoisted(() => ({
  mockRegisterRaster: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: () => true,
  registerNativeRasterAsset: mockRegisterRaster,
  registerNativeImageAsset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/stickers/cache/stickerCache", () => ({
  stickerCacheManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
  getStickerCache: () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { rasterizeTextLayerForNative, paintTextLayersToCanvas } from "@/components/editor/preview/nativeTextPreview";
import { NativeRasterBridge } from "@/core/render/nativeRasterBridge";

describe("PRV-02: Text Preview / Export Parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleTextLayer: EvaluatedTextLayer = {
    layerId: "layer-text-1",
    clipId: "clip-text-1",
    layerType: "text",
    role: "text",
    zIndex: 0,
    inTransition: false,
    blendMode: "normal",
    text: "Clypra Parity Verification",
    fontFamily: "Inter",
    fontSize: 48,
    fontWeight: "bold",
    fontStyle: "normal",
    color: "#ffffff",
    opacity: 1.0,
    x: 960,
    y: 540,
    width: 600,
    height: 120,
    rotation: 0,
    stroke: {
      color: "#000000",
      width: 4,
    },
    shadow: {
      color: "rgba(0, 0, 0, 0.75)",
      blur: 8,
      offsetX: 4,
      offsetY: 4,
    },
    letterSpacing: 2,
    lineHeight: 1.2,
    textAlign: "center",
    verticalAlign: "middle",
  };

  const sampleScene: EvaluatedScene = {
    metadata: {
      time: 0,
      frameRate: 30,
      isGap: false,
      canvasWidth: 1920,
      canvasHeight: 1080,
    },
    visualLayers: [sampleTextLayer],
    audioLayers: [],
    transitions: [],
  };

  it("produces identical layout metrics and pixel bounds between preview raster and export bridge", async () => {
    // 1. Direct rasterization through preview rasterizer
    const previewRaster = await rasterizeTextLayerForNative(sampleTextLayer, {
      phase: "visible-playback",
    });

    expect(previewRaster.width).toBeGreaterThan(0);
    expect(previewRaster.height).toBeGreaterThan(0);
    const previewRgbaLen = (previewRaster.rgba as Uint8ClampedArray).byteLength ?? (previewRaster.rgba as number[]).length;
    expect(previewRgbaLen).toBe(previewRaster.width * previewRaster.height * 4);

    // 2. Rasterization through export bridge
    const exportBridge = new NativeRasterBridge();
    const exportRasters = await exportBridge.rasterize(sampleScene, { frameKey: 0 });

    expect(exportRasters.length).toBe(1);
    const exportRaster = exportRasters[0];

    // 3. 100% Geometry & Parity assertions
    expect(exportRaster.width).toBe(previewRaster.width);
    expect(exportRaster.height).toBe(previewRaster.height);
    expect(exportRaster.x).toBeCloseTo(previewRaster.x, 2);
    expect(exportRaster.y).toBeCloseTo(previewRaster.y, 2);
    expect(exportRaster.opacity).toBe(sampleTextLayer.opacity);
    expect(exportRaster.isText).toBe(true);

    // 4. Assert uploaded texture matches preview raster RGBA bytes exactly
    expect(mockRegisterRaster).toHaveBeenCalledTimes(1);
    const registeredAsset = mockRegisterRaster.mock.calls[0][0];
    expect(registeredAsset.width).toBe(previewRaster.width);
    expect(registeredAsset.height).toBe(previewRaster.height);
    const registeredRgbaLen = (registeredAsset.rgba as Uint8ClampedArray).byteLength ?? (registeredAsset.rgba as number[]).length;
    expect(registeredRgbaLen).toBe(previewRgbaLen);

    exportBridge.dispose();
  });

  it("paints text layers to preview canvas without geometry divergence", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;

    await expect(paintTextLayersToCanvas(canvas, sampleScene)).resolves.not.toThrow();
  });
});
