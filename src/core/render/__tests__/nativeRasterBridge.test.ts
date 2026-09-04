import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatedScene } from "@/core/evaluation/types";
import { buildNativeImageAssetId } from "@/core/render/nativeRasterAssetIds";

const mocks = vi.hoisted(() => ({
  register: vi.fn().mockResolvedValue(undefined),
  registerImage: vi.fn().mockResolvedValue(undefined),
  rasterizeText: vi.fn(),
  textKey: vi.fn(() => "caption-key"),
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

describe("NativeRasterBridge", () => {
  beforeEach(() => {
    mocks.register.mockClear();
    mocks.registerImage.mockReset();
    mocks.registerImage.mockResolvedValue(undefined);
    mocks.rasterizeText.mockReset();
    mocks.textKey.mockClear();
    mocks.traceTextRenderTiming.mockClear();
  });

  it("registers text layers as Studio-engine rasters for native composition", async () => {
    // Layer logical (unscaled base) dims equal texture dims: scale=1, displayWidth=texW
    // x = layer.x + (layerW - displayW)/2 = 10 + (1 - 1)/2 = 10
    const scene = {
      visualLayers: [{ layerType: "text", layerId: "title", x: 10, y: 20, width: 1, height: 1 }],
      metadata: { canvasWidth: 1920, canvasHeight: 1080 },
    } as unknown as EvaluatedScene;
    mocks.rasterizeText.mockResolvedValue({
      assetId: "native-text:title:hash",
      rgba: [255, 255, 255, 255],
      width: 1,
      height: 1,
      x: 10,
      y: 20,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      blendMode: "normal",
      isText: true,
    });
    const bridge = new NativeRasterBridge();

    const rasters = await bridge.rasterize(scene, { frameKey: 0 });
    expect(rasters).toEqual([{
      assetId: "native-text:title:hash",
      width: 1,
      height: 1,
      displayWidth: 1,
      displayHeight: 1,
      x: 10,
      y: 20,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      blendMode: "normal",
      isText: true,
    }]);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "native-text:title:hash",
      rgba: [255, 255, 255, 255],
    }));
    bridge.dispose();
  });


  it("registers still images through the native-owned alpha raster cache", async () => {
    const scene = {
      visualLayers: [{
        layerType: "media",
        layerId: "logo",
        mediaType: "image",
        sourcePath: "/Users/test/logo.png",
        width: 2,
        height: 2,
        x: 12,
        y: 24,
        rotation: 0,
        opacity: 1,
        zIndex: 4,
        blendMode: "normal",
      }],
      metadata: { canvasWidth: 1920, canvasHeight: 1080 },
    } as unknown as EvaluatedScene;
    const bridge = new NativeRasterBridge();

    const rasters = await bridge.rasterize(scene, { frameKey: 0 });
    const movedRasters = await bridge.rasterize({
      ...scene,
      visualLayers: [{ ...(scene.visualLayers[0] as object), x: 80, y: 96 }],
    } as unknown as EvaluatedScene, { frameKey: 1 });

    expect(mocks.registerImage).toHaveBeenCalledWith({
      assetId: buildNativeImageAssetId("/Users/test/logo.png", 2, 2),
      sourcePath: "/Users/test/logo.png",
      width: 2,
      height: 2,
    });
    expect(mocks.registerImage).toHaveBeenCalledTimes(1);
    expect(rasters).toEqual([{
      assetId: buildNativeImageAssetId("/Users/test/logo.png", 2, 2),
      width: 2,
      height: 2,
      x: 12,
      y: 24,
      rotation: 0,
      opacity: 1,
      zIndex: 4,
      blendMode: "normal",
      isText: false,
    }]);
    expect(movedRasters[0]).toMatchObject({ x: 80, y: 96 });
    expect(mocks.register).not.toHaveBeenCalledWith(expect.objectContaining({ rgba: expect.anything() }));
    await expect(bridge.reregister(rasters)).resolves.toBe(true);
    expect(mocks.registerImage).toHaveBeenCalledTimes(2);
    bridge.dispose();
  });

  it("keeps the source texture stable while transform placement changes", async () => {
    const scene = {
      visualLayers: [{
        layerType: "media",
        layerId: "logo",
        mediaType: "image",
        sourcePath: "/Users/test/logo.png",
        sourceWidth: 1920,
        sourceHeight: 1080,
        width: 640,
        height: 360,
        x: 12,
        y: 24,
        rotation: 0,
        opacity: 1,
        zIndex: 4,
        blendMode: "normal",
      }],
      metadata: { canvasWidth: 1920, canvasHeight: 1080 },
    } as unknown as EvaluatedScene;
    const bridge = new NativeRasterBridge();

    const first = await bridge.rasterize(scene, { frameKey: 0 });
    const resized = await bridge.rasterize({
      ...scene,
      visualLayers: [{ ...(scene.visualLayers[0] as object), width: 320, height: 180 }],
    } as unknown as EvaluatedScene, { frameKey: 1 });

    expect(mocks.registerImage).toHaveBeenCalledTimes(1);
    expect(mocks.registerImage).toHaveBeenCalledWith({
      assetId: buildNativeImageAssetId("/Users/test/logo.png", 1920, 1080),
      sourcePath: "/Users/test/logo.png",
      width: 1920,
      height: 1080,
    });
    expect(first[0]).toMatchObject({ width: 1920, height: 1080, displayWidth: 640, displayHeight: 360 });
    expect(resized[0]).toMatchObject({ width: 1920, height: 1080, displayWidth: 320, displayHeight: 180 });
    bridge.dispose();
  });

  it("keeps animated playback text preparation latest-only", async () => {
    let resolveFirst!: (asset: object) => void;
    let resolveLatest!: (asset: object) => void;
    const first = new Promise<object>((resolve) => { resolveFirst = resolve; });
    const latest = new Promise<object>((resolve) => { resolveLatest = resolve; });
    mocks.textKey.mockImplementation((layer?: { time?: number }) => `caption-${layer?.time}`);
    mocks.rasterizeText
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(latest);
    const scene = {
      visualLayers: [{ layerType: "text", layerId: "title", time: 0 }],
      metadata: { canvasWidth: 1920, canvasHeight: 1080 },
    } as unknown as EvaluatedScene;
    const bridge = new NativeRasterBridge();

    await bridge.rasterize(scene, { frameKey: 0, phase: "visible-playback", nonBlockingText: true });
    await bridge.rasterize({
      ...scene,
      visualLayers: [{ ...(scene.visualLayers[0] as object), time: 1 }],
    } as unknown as EvaluatedScene, { frameKey: 1, phase: "visible-playback", nonBlockingText: true });
    await bridge.rasterize({
      ...scene,
      visualLayers: [{ ...(scene.visualLayers[0] as object), time: 2 }],
    } as unknown as EvaluatedScene, { frameKey: 2, phase: "visible-playback", nonBlockingText: true });

    expect(mocks.rasterizeText).toHaveBeenCalledTimes(1);
    resolveFirst({
      assetId: "native-text:title:0", rgba: [255, 255, 255, 255], width: 1, height: 1,
      x: 0, y: 0, rotation: 0, opacity: 1, zIndex: 0, blendMode: "normal", isText: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mocks.rasterizeText).toHaveBeenCalledTimes(2);
    expect((mocks.rasterizeText.mock.calls[1]?.[0] as { time?: number }).time).toBe(2);
    resolveLatest({
      assetId: "native-text:title:2", rgba: [255, 255, 255, 255], width: 1, height: 1,
      x: 0, y: 0, rotation: 0, opacity: 1, zIndex: 0, blendMode: "normal", isText: true,
    });
    bridge.dispose();
  });

  it("updates text placement during non-blocking playback without freezing at pause coordinates", async () => {
    // Layer logical dims (unscaled base): width=280, height=70
    // Texture dims include bleed: texW = 280 + 2*10 = 300, texH = 70 + 2*5 = 80
    // Scale=1 (no animation), so displayWidth=300, displayHeight=80
    // x = layer.x + (layerW - displayW)/2 = layer.x + (280 - 300)/2 = layer.x - 10 (= layer.x - bleedX)
    const scene = {
      visualLayers: [{
        layerType: "text",
        layerId: "synced-title",
        text: "Sync me",
        x: 100,
        y: 200,
        width: 280,
        height: 70,
        rotation: 0,
        opacity: 1,
        zIndex: 5,
        blendMode: "normal",
      }],
      metadata: { canvasWidth: 1920, canvasHeight: 1080 },
    } as unknown as EvaluatedScene;

    mocks.rasterizeText.mockResolvedValue({
      assetId: "native-text:synced-title:v1",
      rgba: [255, 255, 255, 255],
      width: 300,
      height: 80,
      x: 100,
      y: 200,
      rotation: 0,
      opacity: 1,
      zIndex: 5,
      blendMode: "normal",
      isText: true,
      bleedX: 10,
      bleedY: 5,
      positionMode: "centered",
    });

    const bridge = new NativeRasterBridge();

    // 1. First render at pause (blocking mode): rasterizes text and stores snapshot
    const pauseRasters = await bridge.rasterize(scene, { frameKey: 0, phase: "interactive-preview", nonBlockingText: false });
    expect(pauseRasters).toHaveLength(1);
    expect(pauseRasters[0]).toMatchObject({
      assetId: "native-text:synced-title:v1",
      x: 90, // 100 + (280 - 300)/2 = 100 - 10 = 90 (same as old layer.x - bleedX)
      y: 195, // 200 + (70 - 80)/2 = 200 - 5 = 195
      opacity: 1,
      zIndex: 5,
    });

    // 2. Playback starts (non-blocking mode): text moves across timeline frames
    const playingSceneFrame1 = {
      ...scene,
      visualLayers: [{
        ...(scene.visualLayers[0] as object),
        x: 150,
        y: 250,
        opacity: 0.8,
        rotation: 15,
      }],
    } as unknown as EvaluatedScene;

    const playbackRasters1 = await bridge.rasterize(playingSceneFrame1, {
      frameKey: 1,
      phase: "visible-playback",
      nonBlockingText: true,
    });

    expect(playbackRasters1).toHaveLength(1);
    expect(playbackRasters1[0]).toMatchObject({
      assetId: "native-text:synced-title:v1",
      x: 140, // 150 + (280 - 300)/2 = 150 - 10 = 140 (live position updated!)
      y: 245, // 250 + (70 - 80)/2 = 250 - 5 = 245 (live position updated!)
      opacity: 0.8,
      rotation: 15,
      zIndex: 5,
    });

    // 3. Playback advances further
    const playingSceneFrame2 = {
      ...scene,
      visualLayers: [{
        ...(scene.visualLayers[0] as object),
        x: 200,
        y: 300,
        opacity: 0.5,
      }],
    } as unknown as EvaluatedScene;

    const playbackRasters2 = await bridge.rasterize(playingSceneFrame2, {
      frameKey: 2,
      phase: "visible-playback",
      nonBlockingText: true,
    });

    expect(playbackRasters2[0]).toMatchObject({
      x: 190, // 200 + (280 - 300)/2 = 200 - 10 = 190
      y: 295, // 300 + (70 - 80)/2 = 300 - 5 = 295
      opacity: 0.5,
    });

    bridge.dispose();
  });


  it("handles absolute position mode during non-blocking playback", async () => {
    const scene = {
      visualLayers: [{
        layerType: "text",
        layerId: "abs-title",
        text: "Absolute text",
        x: 50,
        y: 60,
      }],
      metadata: { canvasWidth: 1920, canvasHeight: 1080 },
    } as unknown as EvaluatedScene;

    mocks.rasterizeText.mockResolvedValue({
      assetId: "native-text:abs-title:v1",
      rgba: [255, 255, 255, 255],
      width: 200,
      height: 50,
      x: 50,
      y: 60,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      blendMode: "normal",
      isText: true,
      bleedX: 15,
      bleedY: 15,
      positionMode: "absolute",
    });

    const bridge = new NativeRasterBridge();

    // Initial render at pause
    const initialRasters = await bridge.rasterize(scene, { frameKey: 0 });
    expect(initialRasters[0].x).toBe(50); // no bleed subtraction in absolute mode

    // Non-blocking playback render
    const playbackRasters = await bridge.rasterize(scene, {
      frameKey: 1,
      phase: "visible-playback",
      nonBlockingText: true,
    });
    expect(playbackRasters[0].x).toBe(50);

    bridge.dispose();
  });
});

