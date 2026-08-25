import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatedScene } from "@/core/evaluation/types";

const mocks = vi.hoisted(() => ({
  register: vi.fn().mockResolvedValue(undefined),
  rasterizeText: vi.fn(),
  textKey: vi.fn(() => "caption-key"),
}));

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: () => true,
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
});
