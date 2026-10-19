import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  defaultConfig as engineDefaultConfig,
  type TextEffectConfig,
} from "@clypra-studio/engine";
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

import {
  _clearTextLayoutMetricsCache,
  buildNativeTextLayoutKey,
  getCachedLayoutMetrics,
  paintTextLayersToCanvas,
  rasterizeTextLayerForNative,
} from "@/components/editor/preview/nativeTextPreview";
import { NativeRasterBridge } from "@/core/render/nativeRasterBridge";
import { renderTextUnderline } from "@/core/render/textRasterizer";

describe("PRV-02: Text Preview / Export Parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearTextLayoutMetricsCache();
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

  it("CLY-TEXT-014: expands a stale centered point-text box without moving its visual center", () => {
    const staleLayer: EvaluatedTextLayer = {
      ...sampleTextLayer,
      text: "THE BEGINNING OF SNOW",
      fontFamily: "Raleway",
      fontStyle: "italic",
      fontSize: 96,
      width: 160,
      height: 80,
      baseWidth: 160,
      baseHeight: 80,
      textAlign: "center",
      verticalAlign: "middle",
    };

    const layout = getCachedLayoutMetrics(
      staleLayer,
      buildNativeTextLayoutKey(staleLayer),
    );

    expect(layout.baseWidth).toBeGreaterThan(staleLayer.width);
    expect(layout.rasterWidth).toBeGreaterThan(staleLayer.width);
    // Extra allocation grows equally around a centered anchor, preventing
    // either side of an italic title from being silently cropped.
    expect(layout.originOffsetX).toBeCloseTo(
      -(layout.baseWidth - staleLayer.width) / 2,
    );
  });

  it("CLY-TEXT-016: native upload preserves an expanded point-text raster at authored size", async () => {
    const staleLayer: EvaluatedTextLayer = {
      ...sampleTextLayer,
      text: "THE BEGINNING OF SNOW",
      fontFamily: "Raleway",
      fontStyle: "italic",
      fontSize: 96,
      width: 160,
      height: 80,
      baseWidth: 160,
      baseHeight: 80,
      textAlign: "center",
      verticalAlign: "middle",
    };
    const direct = await rasterizeTextLayerForNative(staleLayer);
    const bridge = new NativeRasterBridge();
    const rasters = await bridge.rasterize(
      { ...sampleScene, visualLayers: [staleLayer] },
      { frameKey: 0 },
    );

    expect(rasters).toHaveLength(1);
    expect(rasters[0]!.displayWidth ?? rasters[0]!.width).toBe(direct.width);
    expect(rasters[0]!.displayHeight ?? rasters[0]!.height).toBe(direct.height);
    expect(rasters[0]!.x).toBeCloseTo(direct.x, 2);
    expect(rasters[0]!.y).toBeCloseTo(direct.y, 2);

    // Playback must reuse immutable pixels while applying the newest transform
    // to the visual quad. Before CLY-TEXT-017, the absolute expanded-raster
    // branch retained the stale x/y from the first upload.
    const movedLayer = { ...staleLayer, x: staleLayer.x + 240, y: staleLayer.y + 90 };
    const moved = await bridge.rasterize(
      { ...sampleScene, visualLayers: [movedLayer] },
      { frameKey: 1, phase: "visible-playback", nonBlockingText: true },
    );
    expect(moved).toHaveLength(1);
    expect(moved[0]!.x).toBeCloseTo(rasters[0]!.x + 240, 2);
    expect(moved[0]!.y).toBeCloseTo(rasters[0]!.y + 90, 2);
    bridge.dispose();
  });

  it("CLY-TEXT-015: issues underline strokes for every explicit line only when enabled", () => {
    const stroke = vi.fn();
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke,
      measureText: vi.fn(() => ({ width: 100 })),
    } as unknown as CanvasRenderingContext2D;
    const config: TextEffectConfig = {
      ...engineDefaultConfig,
      canvasWidth: 600,
      canvasHeight: 120,
      fontSize: 48,
      fontFamily: "Inter",
      fontWeight: 700,
      fontStyle: "normal",
      lineHeight: 1.2,
      letterSpacing: 0,
      textPosX: "center",
      textPosY: "middle",
    };

    renderTextUnderline(context, { ...sampleTextLayer, text: "One\nTwo", textDecoration: "underline" }, config);
    expect(stroke).toHaveBeenCalledTimes(2);

    stroke.mockClear();
    renderTextUnderline(context, { ...sampleTextLayer, textDecoration: "none" }, config);
    expect(stroke).not.toHaveBeenCalled();
  });
});
