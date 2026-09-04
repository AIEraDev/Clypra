/**
 * Fix 2: Transform-field audit for NativeRasterBridge text layer paths.
 *
 * Verifies that ALL animatable fields from EvaluatedTextLayer
 * (x, y, displayWidth, displayHeight, rotation, opacity, zIndex, blendMode)
 * are propagated into the NativeRasterLayerSnapshot in every code path:
 *   1. Blocking fresh-raster path (first frame, nonBlockingText: false)
 *   2. Non-blocking fast path (cache hit, nonBlockingText: true)
 *   3. Scale animation — displayWidth/displayHeight scale the immutable
 *      texture quad rather than triggering re-rasterization.
 *
 * Layout geometry used across these tests:
 *   - Layer logical (unscaled base): width=200, height=100
 *   - Texture includes bleed: texW = 200 + 2*5 = 210, texH = 100 + 2*5 = 110
 *   - Scale=1 → displayWidth=210, x = layerX + (200 - 210)/2 = layerX - 5 (= layerX - bleedX)
 *   - Scale=0.5 (from entrance animation, layerW = 0.5 * baseW = 100):
 *       displayWidth = 210 * (100/200) = 105
 *       x = layerX + (100 - 105)/2 = layerX - 2.5
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatedScene } from "@/core/evaluation/types";

const mocks = vi.hoisted(() => ({
  register: vi.fn().mockResolvedValue(undefined),
  registerImage: vi.fn().mockResolvedValue(undefined),
  rasterizeText: vi.fn(),
  textKey: vi.fn(() => "audit-key"),
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

/** Base texture: 210x110 (includes 5px bleed on each side for a 200x100 logical box). */
const BASE_ASSET = {
  assetId: "native-text:audit-layer:v1",
  rgba: [255, 255, 255, 255],
  width: 210,
  height: 110,
  x: 0,
  y: 0,
  rotation: 0,
  opacity: 1,
  zIndex: 3,
  blendMode: "normal",
  isText: true as const,
  bleedX: 5,
  bleedY: 5,
  positionMode: "centered" as const,
};

function makeScene(overrides: object = {}): EvaluatedScene {
  return {
    visualLayers: [{
      layerType: "text",
      layerId: "audit-layer",
      text: "Hello",
      x: 100,
      y: 200,
      baseWidth: 200,
      baseHeight: 100,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 1,
      zIndex: 3,
      blendMode: "normal",
      ...overrides,
    }],
    metadata: { canvasWidth: 1920, canvasHeight: 1080 },
  } as unknown as EvaluatedScene;
}

describe("NativeRasterBridge — Fix 2 transform field audit", () => {
  beforeEach(() => {
    mocks.register.mockClear();
    mocks.rasterizeText.mockReset();
    mocks.rasterizeText.mockResolvedValue({ ...BASE_ASSET });
    mocks.textKey.mockReturnValue("audit-key");
  });

  // ── Path 1: Blocking fresh-raster path ──────────────────────────────────────

  it("blocking path (scale=1): propagates all transform fields and sets displayWidth/displayHeight", async () => {
    const bridge = new NativeRasterBridge();
    const scene = makeScene({ rotation: 45, opacity: 0.7, zIndex: 9, blendMode: "multiply" });

    const [result] = await bridge.rasterize(scene, { frameKey: 0, nonBlockingText: false });

    // Texture dims (immutable): 210x110
    expect(result.width).toBe(210);
    expect(result.height).toBe(110);

    // Display dims — scale=1 so displayW = 210, displayH = 110
    expect(result.displayWidth).toBe(210);
    expect(result.displayHeight).toBe(110);

    // Quad x/y: x = 100 + (200 - 210)/2 = 95, y = 200 + (100 - 110)/2 = 195
    expect(result.x).toBe(95);
    expect(result.y).toBe(195);

    expect(result.rotation).toBe(45);
    expect(result.opacity).toBe(0.7);
    expect(result.zIndex).toBe(9);
    expect(result.blendMode).toBe("multiply");

    bridge.dispose();
  });

  it("blocking path (scale=0.5 entrance animation): displayWidth/displayHeight scale with animation", async () => {
    const bridge = new NativeRasterBridge();
    // Scale animation: layerW = 0.5 * baseW = 100
    const scene = makeScene({
      width: 100,
      height: 50,
      baseWidth: 200,
      baseHeight: 100,
      opacity: 0.4,
      x: 200,
      y: 300,
    });

    const [result] = await bridge.rasterize(scene, { frameKey: 0, nonBlockingText: false });

    expect(result.width).toBe(210);
    expect(result.height).toBe(110);

    // scaleX = 100/200 = 0.5, displayWidth = 210 * 0.5 = 105
    expect(result.displayWidth).toBeCloseTo(105, 5);
    expect(result.displayHeight).toBeCloseTo(55, 5);

    // x = 200 + (100 - 105)/2 = 197.5
    // y = 300 + (50 - 55)/2 = 297.5
    expect(result.x).toBeCloseTo(197.5, 5);
    expect(result.y).toBeCloseTo(297.5, 5);

    expect(result.opacity).toBe(0.4);

    bridge.dispose();
  });

  // ── Path 2: Non-blocking fast path (cache hit) ──────────────────────────────

  it("non-blocking path (scale=1): propagates all live transform fields from the current frame", async () => {
    const bridge = new NativeRasterBridge();

    // Warm the cache
    await bridge.rasterize(makeScene(), { frameKey: 0, nonBlockingText: false });

    const scene = makeScene({
      x: 500,
      y: 600,
      rotation: 30,
      opacity: 0.6,
      zIndex: 7,
      blendMode: "add",
    });

    const [result] = await bridge.rasterize(scene, {
      frameKey: 1,
      phase: "visible-playback",
      nonBlockingText: true,
    });

    expect(result.width).toBe(210);
    expect(result.height).toBe(110);
    expect(result.displayWidth).toBe(210);
    expect(result.displayHeight).toBe(110);

    // x = 500 + (200 - 210)/2 = 495
    expect(result.x).toBe(495);
    expect(result.y).toBe(595);

    expect(result.rotation).toBe(30);
    expect(result.opacity).toBe(0.6);
    expect(result.zIndex).toBe(7);
    expect(result.blendMode).toBe("add");

    bridge.dispose();
  });

  it("non-blocking path (scale=0.5 animation frame): displayWidth/displayHeight update live each frame", async () => {
    const bridge = new NativeRasterBridge();

    // Warm cache at full scale
    await bridge.rasterize(makeScene(), { frameKey: 0, nonBlockingText: false });

    // Animation frame at 0.5 scale
    const scaledScene = makeScene({
      width: 100,
      height: 50,
      baseWidth: 200,
      baseHeight: 100,
      x: 300,
      y: 400,
      opacity: 0.5,
    });

    const [result] = await bridge.rasterize(scaledScene, {
      frameKey: 1,
      phase: "visible-playback",
      nonBlockingText: true,
    });

    expect(result.width).toBe(210);
    expect(result.height).toBe(110);

    // scaleX = 100/200 = 0.5 -> displayWidth = 105
    expect(result.displayWidth).toBeCloseTo(105, 5);
    expect(result.displayHeight).toBeCloseTo(55, 5);

    // x = 300 + (100 - 105)/2 = 297.5
    expect(result.x).toBeCloseTo(297.5, 5);
    expect(result.y).toBeCloseTo(397.5, 5);
    expect(result.opacity).toBe(0.5);

    bridge.dispose();
  });

  // ── Rasterize-once efficiency ────────────────────────────────────────────────

  it("rasterize is called once; subsequent animation frames hit the non-blocking fast path", async () => {
    const bridge = new NativeRasterBridge();

    await bridge.rasterize(makeScene({ opacity: 1.0 }), { frameKey: 0, nonBlockingText: false });
    expect(mocks.rasterizeText).toHaveBeenCalledTimes(1);

    for (let frame = 1; frame <= 3; frame++) {
      const [r] = await bridge.rasterize(makeScene({ opacity: 1.0 - frame * 0.1 }), {
        frameKey: frame,
        phase: "visible-playback",
        nonBlockingText: true,
      });
      expect(r.assetId).toBe("native-text:audit-layer:v1");
      expect(r.opacity).toBeCloseTo(1.0 - frame * 0.1, 5);
    }

    // Only one actual rasterization
    expect(mocks.rasterizeText).toHaveBeenCalledTimes(1);

    bridge.dispose();
  });

  // ── Absolute position mode ───────────────────────────────────────────────────

  it("absolute position mode: x/y stay at asset coordinates regardless of layer scale", async () => {
    mocks.rasterizeText.mockResolvedValue({
      ...BASE_ASSET,
      positionMode: "absolute" as const,
      x: 77,
      y: 88,
    });

    const bridge = new NativeRasterBridge();

    const [initial] = await bridge.rasterize(makeScene({ x: 999, y: 999 }), {
      frameKey: 0,
      nonBlockingText: false,
    });
    expect(initial.x).toBe(77);
    expect(initial.y).toBe(88);

    const [cached] = await bridge.rasterize(makeScene({ x: 0, y: 0 }), {
      frameKey: 1,
      phase: "visible-playback",
      nonBlockingText: true,
    });
    expect(cached.x).toBe(77);
    expect(cached.y).toBe(88);

    bridge.dispose();
  });
});
