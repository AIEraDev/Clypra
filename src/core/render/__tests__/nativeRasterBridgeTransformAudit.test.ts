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

  it("text-template with absolute position mode: x/y update immediately to layer.x/y + bleed without seeking", async () => {
    mocks.rasterizeText.mockResolvedValue({
      ...BASE_ASSET,
      positionMode: "absolute" as const,
      bleedX: 0,
      bleedY: 0,
      x: 205,
      y: 792,
    });

    const bridge = new NativeRasterBridge();

    // Initial render at (205, 792)
    const [initial] = await bridge.rasterize(
      makeScene({ clipKind: "text-template", templateId: "intro-banner", x: 205, y: 792 }),
      { frameKey: 0, nonBlockingText: false, phase: "interactive-preview" },
    );
    expect(initial.x).toBe(205);
    expect(initial.y).toBe(792);

    // User transformed the clip to (350, 500) at the SAME playhead frame.
    // The raster texture is cached, but positioned x/y must immediately reflect (350, 500).
    const [transformed] = await bridge.rasterize(
      makeScene({ clipKind: "text-template", templateId: "intro-banner", x: 350, y: 500 }),
      { frameKey: 0, nonBlockingText: false, phase: "interactive-preview" },
    );
    expect(transformed.x).toBe(350);
    expect(transformed.y).toBe(500);

    // Live snapshot stored in bridge must also reflect (350, 500)
    const snapshot = bridge.getTextSnapshot("audit-layer");
    expect(snapshot).toBeDefined();
    expect(snapshot?.x).toBe(350);
    expect(snapshot?.y).toBe(500);

    bridge.dispose();
  });

  it("content-bounded text-template: displayWidth and displayHeight scale immediately to match layer.width and layer.height during resize", async () => {
    mocks.rasterizeText.mockResolvedValue({
      ...BASE_ASSET,
      width: 669,
      height: 334,
      positionMode: "absolute" as const,
      bleedX: 0,
      bleedY: 0,
      x: 205,
      y: 792,
    });

    const bridge = new NativeRasterBridge();

    // Initial render at 669x334
    const [initial] = await bridge.rasterize(
      makeScene({
        clipKind: "text-template",
        templateId: "intro-banner",
        x: 205,
        y: 792,
        width: 669,
        height: 334,
        baseWidth: 669,
        baseHeight: 334,
      }),
      { frameKey: 0, nonBlockingText: false, phase: "interactive-preview" },
    );
    expect(initial.displayWidth).toBe(669);
    expect(initial.displayHeight).toBe(334);

    // User resized the clip (e.g. dragged East handle to widen to 900x334)
    // The raster texture is cached at 669x334, but displayWidth must scale directly to 900
    const [resized] = await bridge.rasterize(
      makeScene({
        clipKind: "text-template",
        templateId: "intro-banner",
        x: 205,
        y: 792,
        width: 900,
        height: 334,
        baseWidth: 669,
        baseHeight: 334,
      }),
      { frameKey: 0, nonBlockingText: false, phase: "interactive-preview" },
    );
    expect(resized.displayWidth).toBe(900);
    expect(resized.displayHeight).toBe(334);
    expect(resized.x).toBe(205);
    expect(resized.y).toBe(792);

    bridge.dispose();
  });

  it("text-effect with absolute position mode: x/y update immediately to layer.x/y + bleed without seeking", async () => {
    mocks.rasterizeText.mockResolvedValue({
      ...BASE_ASSET,
      width: 320,
      height: 120,
      positionMode: "absolute" as const,
      bleedX: -30,
      bleedY: -15,
      x: 370,
      y: 285,
    });

    const bridge = new NativeRasterBridge();

    // Initial render at (400, 300) with bleed (-30, -15) => quad at (370, 285)
    const [initial] = await bridge.rasterize(
      makeScene({
        clipKind: "text",
        styleId: "neon-crimson",
        x: 400,
        y: 300,
        width: 320,
        height: 120,
        baseWidth: 320,
        baseHeight: 120,
      }),
      { frameKey: 0, nonBlockingText: false, phase: "interactive-preview" },
    );
    expect(initial.x).toBe(370);
    expect(initial.y).toBe(285);

    // User transformed the text effect to (550, 420) at the SAME playhead frame.
    // The raster texture is cached, and positioned x/y must immediately reflect (550 - 30, 420 - 15) = (520, 405).
    const [transformed] = await bridge.rasterize(
      makeScene({
        clipKind: "text",
        styleId: "neon-crimson",
        x: 550,
        y: 420,
        width: 320,
        height: 120,
        baseWidth: 320,
        baseHeight: 120,
      }),
      { frameKey: 0, nonBlockingText: false, phase: "interactive-preview" },
    );
    expect(transformed.x).toBe(520);
    expect(transformed.y).toBe(405);

    // Live snapshot stored in bridge must also reflect (520, 405)
    const snapshot = bridge.getTextSnapshot("audit-layer");
    expect(snapshot).toBeDefined();
    expect(snapshot?.x).toBe(520);
    expect(snapshot?.y).toBe(405);

    bridge.dispose();
  });

  it("text-effect interactive resize: displayWidth, displayHeight, and position scale immediately during drag", async () => {
    mocks.rasterizeText.mockResolvedValue({
      ...BASE_ASSET,
      width: 300,
      height: 100,
      positionMode: "absolute" as const,
      bleedX: -20,
      bleedY: -10,
      x: 380,
      y: 290,
    });

    const bridge = new NativeRasterBridge();

    // Initial render at width 300, height 100 at (400, 300)
    const [initial] = await bridge.rasterize(
      makeScene({
        clipKind: "text",
        styleId: "neon-crimson",
        x: 400,
        y: 300,
        width: 300,
        height: 100,
        baseWidth: 300,
        baseHeight: 100,
      }),
      { frameKey: 0, nonBlockingText: false, phase: "interactive-preview" },
    );
    expect(initial.displayWidth).toBe(300);
    expect(initial.displayHeight).toBe(100);
    expect(initial.x).toBe(380);
    expect(initial.y).toBe(290);

    // User dynamically resizes the text effect to 450x150 (1.5x) at (375, 275)
    const [resized] = await bridge.rasterize(
      makeScene({
        clipKind: "text",
        styleId: "neon-crimson",
        x: 375,
        y: 275,
        width: 450,
        height: 150,
        baseWidth: 300,
        baseHeight: 100,
      }),
      { frameKey: 0, nonBlockingText: false, phase: "interactive-preview" },
    );
    expect(resized.displayWidth).toBe(450);
    expect(resized.displayHeight).toBe(150);
    // x = 375 + (-20 * 1.5) = 345, y = 275 + (-10 * 1.5) = 260
    expect(resized.x).toBe(345);
    expect(resized.y).toBe(260);

    bridge.dispose();
  });
});


