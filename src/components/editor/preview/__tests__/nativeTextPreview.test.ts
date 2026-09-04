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
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx);
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
});


