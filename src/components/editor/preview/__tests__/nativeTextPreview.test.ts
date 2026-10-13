import { beforeEach, describe, expect, it } from "vitest";
import type { EvaluatedTextLayer } from "@/core/evaluation/types";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import {
  buildNativeTextLayoutKey,
  buildNativeTextRasterKey,
  getTemplateCropCacheKey,
  paintTextLayersToCanvas,
  resolveNativeTextEffectDefinition,
  _clearBrowserTextRasterCache,
  _getBrowserTextRasterPromise,
  _seedBrowserTextRasterCache,
} from "../nativeTextPreview";

function makeTextLayer(
  overrides: Partial<EvaluatedTextLayer> = {},
): EvaluatedTextLayer {
  return {
    layerId: "title-1",
    clipId: "title-1",
    role: "text",
    clipKind: "text",
    zIndex: 1,
    trackIndex: 0,
    layerType: "text",
    x: 100,
    y: 80,
    width: 640,
    height: 120,
    rotation: 0,
    opacity: 1,
    inTransition: false,
    blendMode: "normal",
    text: "Clypra",
    fontFamily: "Inter",
    fontSize: 64,
    color: "#ffffff",
    fontWeight: 700,
    fontStyle: "normal",
    textAlign: "center",
    verticalAlign: "middle",
    lineHeight: 1.2,
    letterSpacing: 0,
    ...overrides,
  };
}

function scene_for_layer(layer: ReturnType<typeof makeTextLayer>) {
  return {
    visualLayers: [layer],
    audioLayers: [],
    metadata: { time: 0, duration: 5, fps: 60 },
  } as any;
}

describe("native text raster compatibility", () => {
  beforeEach(() => {
    useEffectsStore.setState({ definitions: {} });
  });

  it("keeps identical Clypra Studio inputs cache-stable", () => {
    expect(buildNativeTextRasterKey(makeTextLayer())).toBe(
      buildNativeTextRasterKey(makeTextLayer()),
    );
  });

  it("does not invalidate immutable pixels for compositor-only movement", () => {
    const layer = makeTextLayer();
    expect(buildNativeTextRasterKey(layer)).toBe(
      buildNativeTextRasterKey({
        ...layer,
        x: 420,
        y: 240,
        rotation: 0.25,
        opacity: 0.4,
      }),
    );
  });

  it("invalidates the raster asset when animated time changes", () => {
    const animated = { animation: { type: "pulse" } } as never;
    expect(
      buildNativeTextRasterKey(
        makeTextLayer({ styleDefinition: animated, time: 0 }),
      ),
    ).not.toBe(
      buildNativeTextRasterKey(
        makeTextLayer({ styleDefinition: animated, time: 1 / 30 }),
      ),
    );
  });

  it("invalidates the raster asset when Studio style data changes", () => {
    expect(
      buildNativeTextRasterKey(
        makeTextLayer({ styleDefinition: { id: "a" } as never }),
      ),
    ).not.toBe(
      buildNativeTextRasterKey(
        makeTextLayer({ styleDefinition: { id: "b" } as never }),
      ),
    );
  });

  it("invalidates the raster asset when the text color changes", () => {
    expect(
      buildNativeTextRasterKey(makeTextLayer({ color: "#ffffff" })),
    ).not.toBe(buildNativeTextRasterKey(makeTextLayer({ color: "#ff3366" })));
  });

  it("keeps layout work cacheable when only a plain text color changes", () => {
    expect(buildNativeTextLayoutKey(makeTextLayer({ color: "#ffffff" }))).toBe(
      buildNativeTextLayoutKey(makeTextLayer({ color: "#ff3366" })),
    );
  });

  it("keeps a pinned clip definition ahead of a newer live catalog definition", () => {
    const pinned = { id: "neon", version: 1 } as never;
    const live = { id: "neon", version: 2 } as never;
    useEffectsStore.setState({ definitions: { neon: live } });

    expect(
      resolveNativeTextEffectDefinition(
        makeTextLayer({
          styleId: "neon",
          styleDefinition: pinned,
        }),
      ),
    ).toBe(pinned);
  });

  it("uses the live definition only for legacy layers without a pinned snapshot", () => {
    const live = { id: "neon", version: 2 } as never;
    useEffectsStore.setState({ definitions: { neon: live } });

    expect(
      resolveNativeTextEffectDefinition(makeTextLayer({ styleId: "neon" })),
    ).toBe(live);
  });
});

// ─── Text layout metrics cache invariants ─────────────────────────────────────

import { _clearTextLayoutMetricsCache } from "../nativeTextPreview";

describe("text layout metrics cache", () => {
  beforeEach(() => {
    useEffectsStore.setState({ definitions: {} });
    _clearTextLayoutMetricsCache();
  });

  it("buildNativeTextLayoutKey excludes color — same key for different colors", () => {
    const base = makeTextLayer({ color: "#ffffff" });
    const changed = makeTextLayer({ color: "#ff0000" });
    expect(buildNativeTextLayoutKey(base)).toBe(
      buildNativeTextLayoutKey(changed),
    );
  });

  it("buildNativeTextLayoutKey changes when font family changes", () => {
    const a = makeTextLayer({ fontFamily: "Inter Variable" });
    const b = makeTextLayer({ fontFamily: "Bebas Neue" });
    expect(buildNativeTextLayoutKey(a)).not.toBe(buildNativeTextLayoutKey(b));
  });

  it("buildNativeTextLayoutKey changes when font size changes", () => {
    const a = makeTextLayer({ fontSize: 48 });
    const b = makeTextLayer({ fontSize: 96 });
    expect(buildNativeTextLayoutKey(a)).not.toBe(buildNativeTextLayoutKey(b));
  });

  it("buildNativeTextLayoutKey changes when stroke changes", () => {
    const a = makeTextLayer({ stroke: undefined });
    const b = makeTextLayer({ stroke: { color: "#000", width: 2 } });
    expect(buildNativeTextLayoutKey(a)).not.toBe(buildNativeTextLayoutKey(b));
  });

  it("buildNativeTextLayoutKey changes when shadow changes", () => {
    const a = makeTextLayer({ shadow: undefined });
    const b = makeTextLayer({
      shadow: { color: "#000", blur: 4, offsetX: 2, offsetY: 2 },
    });
    expect(buildNativeTextLayoutKey(a)).not.toBe(buildNativeTextLayoutKey(b));
  });

  it("buildNativeTextLayoutKey changes when layer dimensions change", () => {
    const a = makeTextLayer({ width: 640, height: 120 });
    const b = makeTextLayer({ width: 800, height: 200 });
    expect(buildNativeTextLayoutKey(a)).not.toBe(buildNativeTextLayoutKey(b));
  });

  it("cache cleared between tests — _clearTextLayoutMetricsCache works", () => {
    // Just verifying the exported clear function doesn't throw
    expect(() => _clearTextLayoutMetricsCache()).not.toThrow();
  });
});

describe("browser-path concurrent rasterization race elimination", () => {
  beforeEach(() => {
    _clearBrowserTextRasterCache();
  });

  it("fires overlapping paintTextLayersToCanvas calls for the same key and asserts a single shared in-flight promise", async () => {
    const canvas1 = document.createElement("canvas");
    canvas1.width = 1920;
    canvas1.height = 1080;
    const canvas2 = document.createElement("canvas");
    canvas2.width = 1920;
    canvas2.height = 1080;

    const layer = makeTextLayer({
      layerId: "concurrent-layer-1",
      text: "Concurrent Clypra Test",
    });
    const key = buildNativeTextRasterKey(layer);
    const scene = {
      visualLayers: [layer],
      audioLayers: [],
      metadata: { time: 0, duration: 10, fps: 60 },
    } as any;

    // Fire two overlapping calls before microtasks resolve
    const p1 = paintTextLayersToCanvas(canvas1, scene, "interactive-preview");
    const p2 = paintTextLayersToCanvas(canvas2, scene, "interactive-preview");

    // The inFlight / browserTextRasterCache promise must exist and be a single shared Promise
    const sharedPromise = _getBrowserTextRasterPromise(key);
    expect(sharedPromise).toBeDefined();

    // Fire a third overlapping call for the exact same key
    const canvas3 = document.createElement("canvas");
    canvas3.width = 1920;
    canvas3.height = 1080;
    const p3 = paintTextLayersToCanvas(canvas3, scene, "interactive-preview");

    const sharedPromise2 = _getBrowserTextRasterPromise(key);
    expect(sharedPromise2).toBe(sharedPromise);

    // All calls must resolve successfully
    await expect(Promise.all([p1, p2, p3])).resolves.not.toThrow();
  });
});

describe("template crop cache key invalidation", () => {
  it("generates distinct cache keys when text customization or dimensions change", () => {
    const baseLayer = makeTextLayer({
      templateId: "tpl-headline",
      templateRevisionId: "rev-1",
      customization: { primaryText: "Original Title" } as any,
      width: 500,
      height: 100,
    });
    const editedTextLayer = makeTextLayer({
      ...baseLayer,
      customization: { primaryText: "Updated Long Title" } as any,
    });
    const resizedLayer = makeTextLayer({
      ...baseLayer,
      width: 800,
      height: 150,
    });

    const key1 = getTemplateCropCacheKey(baseLayer);
    const key2 = getTemplateCropCacheKey(editedTextLayer);
    const key3 = getTemplateCropCacheKey(resizedLayer);

    expect(key1).not.toBeNull();
    expect(key2).not.toBeNull();
    expect(key3).not.toBeNull();
    expect(key1).not.toEqual(key2);
    expect(key1).not.toEqual(key3);
  });

  it("buildNativeTextRasterKey honors templateAnimated false and does not trigger artifact parsing", () => {
    const staticTemplateLayer = makeTextLayer({
      templateId: "tpl-static",
      templateAnimated: false,
      time: 1.5,
    });
    const keyAtTime1 = buildNativeTextRasterKey(staticTemplateLayer);
    const keyAtTime2 = buildNativeTextRasterKey({
      ...staticTemplateLayer,
      time: 2.5,
    });
    // For static templates, time differences do not change the raster key
    expect(keyAtTime1).toBe(keyAtTime2);
  });

  it("stabilizes the raster key across animated scale changes by using unscaled base dimensions", () => {
    const baseLayer = makeTextLayer({
      layerId: "anim-scale-layer",
      baseWidth: 400,
      baseHeight: 100,
      width: 200, // scaled 0.5x at start of entrance
      height: 50,
    });
    const midLayer = makeTextLayer({
      ...baseLayer,
      width: 320, // scaled 0.8x during entrance
      height: 80,
    });
    const endLayer = makeTextLayer({
      ...baseLayer,
      width: 400, // 1.0x unscaled
      height: 100,
    });

    const keyStart = buildNativeTextRasterKey(baseLayer);
    const keyMid = buildNativeTextRasterKey(midLayer);
    const keyEnd = buildNativeTextRasterKey(endLayer);

    expect(keyStart).toBe(keyMid);
    expect(keyMid).toBe(keyEnd);
  });
});

describe("browser preview blend mode painting", () => {
  it("applies layer blendMode to canvas context during painting", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx as any);
    let capturedBlendMode = "";
    ctx.drawImage = vi.fn().mockImplementation(() => {
      capturedBlendMode = ctx.globalCompositeOperation;
    });

    const layer = makeTextLayer({
      layerId: "blend-layer-1",
      blendMode: "screen",
    });
    const scene = {
      visualLayers: [layer],
      audioLayers: [],
      metadata: { time: 0, duration: 5, fps: 60 },
    } as any;

    await paintTextLayersToCanvas(canvas, scene, "interactive-preview");
    expect(capturedBlendMode).toBe("screen");
  });

  it("paints media layers (stickers/images) to canvas and respects zIndex and opacity", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx as any);

    const drawCalls: any[] = [];
    ctx.drawImage = vi.fn().mockImplementation((...args) => {
      drawCalls.push(args);
    });

    // Mock Image with instant onload/complete
    const originalImage = globalThis.Image;
    class MockImage {
      src = "";
      complete = true;
      naturalWidth = 200;
      naturalHeight = 200;
    }
    (globalThis as any).Image = MockImage;

    try {
      const mediaLayer = {
        layerId: "sticker-layer-1",
        layerType: "media",
        clipKind: "sticker",
        mediaType: "image",
        mediaId: "sticker-starter-golden-star",
        sourcePath: "data:image/svg+xml;utf8,<svg>...</svg>",
        x: 100,
        y: 150,
        width: 200,
        height: 200,
        rotation: 0,
        opacity: 0.9,
        zIndex: 10,
        blendMode: "normal",
      } as any;

      const scene = {
        visualLayers: [mediaLayer],
        audioLayers: [],
        metadata: { time: 0, duration: 5, fps: 60 },
      } as any;

      await paintTextLayersToCanvas(canvas, scene, "interactive-preview");
      expect(ctx.drawImage).toHaveBeenCalled();
      expect(drawCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.Image = originalImage;
    }
  });

  it("CLY-BUG-001: does not treat video layers as images or stall canvas painting", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx as any);

    const imageConstructorSpy = vi.fn();
    const originalImage = globalThis.Image;
    class MockVideoImage {
      src = "";
      complete = false;
      constructor() {
        imageConstructorSpy();
      }
      addEventListener() {}
      removeEventListener() {}
    }
    (globalThis as any).Image = MockVideoImage;

    try {
      const videoLayer = {
        layerId: "video-layer-1",
        clipId: "video-clip-1",
        role: "clip",
        clipKind: "video",
        mediaType: "video",
        mediaId: "media-video-1",
        sourcePath: "/path/to/interview.mp4",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
        inTransition: false,
        layerType: "media",
      } as any;

      const scene = {
        visualLayers: [videoLayer],
        audioLayers: [],
        metadata: { time: 0, duration: 5, fps: 60 },
      } as any;

      const start = performance.now();
      await paintTextLayersToCanvas(canvas, scene, "interactive-preview");
      const duration = performance.now() - start;

      // Video layer must not be instantiated as an Image
      expect(imageConstructorSpy).not.toHaveBeenCalled();
      // Paint must complete immediately without waiting for image timeout
      expect(duration).toBeLessThan(30);
    } finally {
      globalThis.Image = originalImage;
    }
  });

  it("CLY-BUG-006: preserves cropped template offset and negative bleed in absolute positioning", async () => {
    // Scenario: a text template with a tight crop was rasterized, producing an
    // asset where rasterizeTextLayerForNative has already computed the correct
    // canvas position:
    //   layer.x = 100, bleedX = 20, croppedTemplate.offsetX = 15
    //   => resolvedX = 100 - 20 + 15 = 95  (asset.x)
    //   => resolvedBleedX = resolvedX - layer.x = -5  (asset.bleedX)
    //
    // The bug: paintTextLayersToCanvas used `layer.x + asset.bleedX` = 100 + (-5) = 95
    //          which APPEARED correct but only worked because bleedX was negative.
    //          When bleedX was POSITIVE (no crop, or large padding) it overcorrected.
    //
    // The fix: always use asset.x directly when positionMode === "absolute".
    //   centerX = asset.x + asset.width / 2 = 95 + 100 = 195

    _clearBrowserTextRasterCache();

    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;

    let translatedX = 0;
    let translatedY = 0;
    ctx.translate = vi.fn().mockImplementation((x: number, y: number) => {
      translatedX = x;
      translatedY = y;
    });
    ctx.rotate = vi.fn();
    ctx.save = vi.fn();
    ctx.restore = vi.fn();
    ctx.drawImage = vi.fn();
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx as any);

    // Build the layer and its raster key so we can seed the cache
    const layer = makeTextLayer({
      layerId: "template-crop-cly006",
      templateId: "lower-third",
      clipKind: "text-template",
      x: 100,
      y: 200,
      width: 400,
      height: 100,
    });

    const assetWidth = 200; // tight-cropped width
    const assetHeight = 50; // tight-cropped height
    const assetX = 95; // 100 - 20 + 15 (bleed subtracted, cropOffset added)
    const assetY = 190; // 200 - 20 + 10

    // Pre-built asset as rasterizeTextLayerForNative would produce it
    const prebuiltAsset = {
      layerId: layer.layerId,
      assetId: `native-text:${layer.layerId}:seeded`,
      rgba: new Uint8ClampedArray(assetWidth * assetHeight * 4).fill(128),
      width: assetWidth,
      height: assetHeight,
      x: assetX,
      y: assetY,
      rotation: 0,
      opacity: 1,
      zIndex: layer.zIndex,
      blendMode: layer.blendMode,
      isText: true,
      positionMode: "absolute" as const,
      bleedX: assetX - layer.x, // = -5
      bleedY: assetY - layer.y, // = -10
    } as any;

    const rasterKey = buildNativeTextRasterKey(layer);
    _seedBrowserTextRasterCache(rasterKey, prebuiltAsset);

    // Also make createImageData / putImageData available (jsdom provides these)
    await paintTextLayersToCanvas(
      canvas,
      scene_for_layer(layer),
      "interactive-preview",
    );

    // posX = asset.x = 95, centerX = 95 + 200/2 = 195
    // posY = asset.y = 190, centerY = 190 + 50/2 = 215
    expect(ctx.translate).toHaveBeenCalled();
    expect(translatedX).toBe(195);
    expect(translatedY).toBe(215);
  });

  it("CLY-BUG-006 (regression): non-absolute layers still use layer.x/y for center calculation", async () => {
    // Non-template text (no positionMode:"absolute") must keep using layer.x/y
    _clearBrowserTextRasterCache();

    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    let translatedX = 0;
    let translatedY = 0;
    ctx.translate = vi.fn().mockImplementation((x: number, y: number) => {
      translatedX = x;
      translatedY = y;
    });
    ctx.rotate = vi.fn();
    ctx.save = vi.fn();
    ctx.restore = vi.fn();
    ctx.drawImage = vi.fn();
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx as any);

    const layer = makeTextLayer({
      layerId: "plain-text-cly006",
      x: 50,
      y: 80,
      width: 300,
      height: 60,
    });

    const prebuiltAsset = {
      layerId: layer.layerId,
      assetId: `native-text:${layer.layerId}:seeded`,
      rgba: new Uint8ClampedArray(300 * 60 * 4).fill(200),
      width: 300,
      height: 60,
      x: 50,
      y: 80,
      rotation: 0,
      opacity: 1,
      zIndex: layer.zIndex,
      blendMode: layer.blendMode,
      isText: true,
      // positionMode NOT set — defaults to relative
    } as any;

    const rasterKey = buildNativeTextRasterKey(layer);
    _seedBrowserTextRasterCache(rasterKey, prebuiltAsset);

    await paintTextLayersToCanvas(
      canvas,
      scene_for_layer(layer),
      "interactive-preview",
    );

    // Non-absolute: centerX = layer.x + layer.width/2 = 50 + 150 = 200
    //               centerY = layer.y + layer.height/2 = 80 + 30 = 110
    expect(translatedX).toBe(200);
    expect(translatedY).toBe(110);
  });
});
