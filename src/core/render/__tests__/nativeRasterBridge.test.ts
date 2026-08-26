import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatedScene } from "@/core/evaluation/types";

const mocks = vi.hoisted(() => ({
  register: vi.fn().mockResolvedValue(undefined),
  registerImage: vi.fn().mockResolvedValue(undefined),
  rasterizeText: vi.fn(),
  textKey: vi.fn(() => "caption-key"),
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
  });

  it("shares cached text raster assets with the native compositor and can recover them", async () => {
    const asset = {
      assetId: "native-text:title:hash",
      rgba: [255, 255, 255, 255],
      width: 1,
      height: 1,
      x: 10,
      y: 20,
      rotation: 0,
      opacity: 1,
      zIndex: 2,
      blendMode: "normal",
      isText: true as const,
    };
    mocks.rasterizeText.mockResolvedValue(asset);
    const scene = {
      visualLayers: [{ layerType: "text", layerId: "title" }],
      metadata: { canvasWidth: 1920, canvasHeight: 1080 },
    } as unknown as EvaluatedScene;
    const bridge = new NativeRasterBridge();

    const first = await bridge.rasterize(scene, { frameKey: 0 });
    const second = await bridge.rasterize(scene, { frameKey: 1 });

    expect(first).toEqual([{ ...asset, rgba: undefined }]);
    expect(second).toEqual(first);
    expect(mocks.rasterizeText).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledTimes(1);

    await expect(bridge.reregister(first)).resolves.toBe(true);
    expect(mocks.register).toHaveBeenCalledTimes(2);
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
      assetId: expect.stringMatching(/^native-image:\{/),
      sourcePath: "/Users/test/logo.png",
      width: 2,
      height: 2,
    });
    expect(mocks.registerImage).toHaveBeenCalledTimes(1);
    expect(rasters).toEqual([{
      assetId: expect.stringMatching(/^native-image:\{/),
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
    bridge.dispose();
  });
});
