import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatedScene } from "@/core/evaluation/types";
import { buildNativeImageAssetId } from "@/core/render/nativeRasterAssetIds";

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

  it("excludes text layers from raster bridge since text is natively rendered in wgpu", async () => {
    const scene = {
      visualLayers: [{ layerType: "text", layerId: "title" }],
      metadata: { canvasWidth: 1920, canvasHeight: 1080 },
    } as unknown as EvaluatedScene;
    const bridge = new NativeRasterBridge();

    const rasters = await bridge.rasterize(scene, { frameKey: 0 });
    expect(rasters).toEqual([]);
    expect(mocks.register).not.toHaveBeenCalled();
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
});
