/**
 * fontWaitMs fast-path invariants
 *
 * Verifies that rasterizeTextLayerForNative sets fontWaitMs = 0 for both
 * prewarmed project fonts and OS-resident system fonts. Lives in its own
 * file so its module-level vi.mock() calls do not pollute other test suites.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { getFontLoader, resetFontLoader } from "@/core/fonts/FontLoader";
import type { EvaluatedTextLayer } from "@/core/evaluation/types";

// ─── Module-level mocks ───────────────────────────────────────────────────────
// These are hoisted by Vitest and scoped to this file only.

vi.mock("@/core/render/textRasterizer", () => ({
  rasterizeTextLayer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/text/textClip", () => ({
  effectBleed: vi.fn().mockReturnValue({ x: 0, y: 0 }),
  measureTextEffectContentBounds: vi.fn().mockReturnValue({
    contentWidth: 640,
    contentHeight: 120,
    bleedLeft: 0,
    bleedRight: 0,
    bleedTop: 0,
    bleedBottom: 0,
    measuredTextWidth: 640,
    measuredTextHeight: 120,
    source: "plain",
    selectionInset: 0,
  }),
  resolveTextEffectDefinition: vi.fn().mockReturnValue(undefined),
}));

vi.mock("@/lib/utils/fixedSizing", () => ({
  normalizeFontSize: vi.fn((v: number) => v),
  getTextRenderMetrics: vi.fn().mockReturnValue({ paddingX: 0, paddingY: 0 }),
}));

vi.mock("@/core/render/textRenderTrace", () => ({
  traceTextRenderGeometry: vi.fn(),
  traceTextRenderCacheHit: vi.fn(),
  traceTextRenderTiming: vi.fn(),
}));

vi.mock("@clypra-studio/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clypra-studio/engine")>();
  return { ...actual, resolveTextTemplateArtifact: vi.fn().mockReturnValue(null) };
});

// Minimal OffscreenCanvas stub — returns a canvas context that getImageData
// always resolves to a 1×1 transparent RGBA buffer.
const mockCtx = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  drawImage: vi.fn(),
  putImageData: vi.fn(),
  createImageData: vi.fn((w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
  })),
  getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
};
vi.stubGlobal(
  "OffscreenCanvas",
  class {
    width = 1;
    height = 1;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return mockCtx;
    }
  },
);

// ─── Test helper ─────────────────────────────────────────────────────────────

function makeLayer(overrides: Partial<EvaluatedTextLayer> = {}): EvaluatedTextLayer {
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
    fontFamily: "Inter Variable",
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("rasterizeTextLayerForNative — fontWaitMs fast paths", () => {
  beforeEach(() => {
    resetFontLoader();
    vi.clearAllMocks();

    // Simulate a browser environment where @fontsource CSS has been loaded —
    // document.fonts.check() returns true for all faces.
    const mockFonts = {
      check: vi.fn(() => true),
      load: vi.fn().mockResolvedValue(undefined),
      ready: Promise.resolve(),
    };
    // @ts-ignore
    global.document = { fonts: mockFonts };
  });

  it("fontWaitMs is 0 for a system font (Impact) — isLoaded short-circuits all waits", async () => {
    const { rasterizeTextLayerForNative } = await import("../nativeTextPreview");
    const layer = makeLayer({ fontFamily: "Impact", fontWeight: 700 });

    const asset = await rasterizeTextLayerForNative(layer, { phase: "visible-playback" });

    expect(asset.timing?.fontWaitMs).toBe(0);
  });

  it("fontWaitMs is 0 for a prewarmed bundled font", async () => {
    // Prewarm Inter Variable — simulates what ProjectSession._prewarmProjectFonts does
    await getFontLoader().prewarmProjectFonts(["Inter Variable"]);

    const { rasterizeTextLayerForNative } = await import("../nativeTextPreview");
    const layer = makeLayer({ fontFamily: "Inter Variable", fontWeight: 400 });

    const asset = await rasterizeTextLayerForNative(layer, { phase: "visible-playback" });

    expect(asset.timing?.fontWaitMs).toBe(0);
  });

  it("fontWaitMs is 0 when fontFamily is absent", async () => {
    const { rasterizeTextLayerForNative } = await import("../nativeTextPreview");
    const layer = makeLayer({ fontFamily: "" });

    const asset = await rasterizeTextLayerForNative(layer, { phase: "visible-playback" });

    expect(asset.timing?.fontWaitMs).toBe(0);
  });

  it("isLoaded() returns true for system fonts without any prior ensureFont call", () => {
    const loader = getFontLoader();
    expect(loader.isLoaded({ family: "Arial", weight: 400, style: "normal" })).toBe(true);
    expect(loader.isLoaded({ family: "Impact", weight: 700, style: "normal" })).toBe(true);
    expect(loader.isLoaded({ family: "Georgia", weight: 400, style: "normal" })).toBe(true);
  });

  it("CLY-BUG-001: flags fallback font on timeout and evicts from raster cache once font completes", async () => {
    let resolveFont!: () => void;
    const fontLoadPromise = new Promise<any>((res) => {
      resolveFont = () => res({ font: { family: "CustomFont" }, loaded: true, loadTimeMs: 50 });
    });

    const loader = getFontLoader();
    vi.spyOn(loader, "isLoaded").mockReturnValue(false);
    vi.spyOn(loader, "ensureFont").mockReturnValue(fontLoadPromise);

    const {
      rasterizeTextLayerForNative,
      paintTextLayersToCanvas,
      buildNativeTextRasterKey,
      _getBrowserTextRasterPromise,
      _clearBrowserTextRasterCache,
    } = await import("../nativeTextPreview");

    _clearBrowserTextRasterCache();

    const layer = makeLayer({ fontFamily: "CustomFont", fontWeight: 400 });
    const rasterKey = buildNativeTextRasterKey(layer);

    // 1. Initial render during visible-playback times out after 25ms budget
    const initialAsset = await rasterizeTextLayerForNative(layer, { phase: "visible-playback" });
    expect(initialAsset.isFallbackFont).toBe(true);

    const mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockCtx),
      width: 1920,
      height: 1080,
    } as unknown as HTMLCanvasElement;

    // Trigger paintTextLayersToCanvas to populate browserTextRasterCache
    await paintTextLayersToCanvas(
      mockCanvas,
      { visualLayers: [layer], metadata: {} } as any,
      "visible-playback",
    );
    expect(_getBrowserTextRasterPromise(rasterKey)).toBeDefined();

    // 2. Resolve font in background
    resolveFont();
    await fontLoadPromise;
    await new Promise((r) => setTimeout(r, 10));

    // 3. Fallback entry must be evicted from cache
    expect(_getBrowserTextRasterPromise(rasterKey)).toBeUndefined();
  });
});

