/**
 * Template crop geometry cache — unit tests
 *
 * Tests the cropTemplateAsset / getTemplateCropCacheKey / _clearTemplateCropGeometryCache
 * functions from nativeTextPreview.ts using the real implementations (no mocks).
 *
 * Kept in its own file so it never shares a vi.mock("@clypra-studio/engine")
 * context with the worker client tests, which need different mock behaviour.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { EvaluatedTextLayer } from "@/core/evaluation/types";

// Mock only the heavy store dependencies that nativeTextPreview transitively
// pulls in. The rendering logic we test is pure (no stores).
vi.mock("@/features/text-effects/store/effectsStore", () => ({
  useEffectsStore: {
    getState: () => ({ definitions: {}, prefetchingIds: new Set() }),
    setState: vi.fn(),
  },
}));
vi.mock("@/features/text-templates/templateStore", () => ({
  useTemplateStore: {
    getState: () => ({ templates: [] }),
    setState: vi.fn(),
  },
}));
vi.mock("@/store/timelineStore", () => ({
  useTimelineStore: {
    getState: () => ({ epoch: 0, incrementEpoch: vi.fn() }),
  },
}));
vi.mock("@/core/evaluation/evaluator", () => ({
  invalidateEvaluationCache: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLayer(
  overrides: Partial<EvaluatedTextLayer> = {},
): EvaluatedTextLayer {
  return {
    layerId: "layer-1",
    clipId: "clip-1",
    role: "text",
    clipKind: "text-template",
    zIndex: 1,
    trackIndex: 0,
    layerType: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 1,
    inTransition: false,
    blendMode: "normal",
    text: "Test",
    fontFamily: "Inter Variable",
    fontSize: 32,
    color: "#ffffff",
    fontWeight: 400,
    fontStyle: "normal",
    textAlign: "center",
    verticalAlign: "middle",
    lineHeight: 1.2,
    letterSpacing: 0,
    ...overrides,
  };
}

/** Build a Uint8ClampedArray with one visible pixel at (x, y) in a W×H canvas. */
function makeRgbaWithPixelAt(
  width: number,
  height: number,
  px: number,
  py: number,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const idx = (py * width + px) * 4;
  rgba[idx] = 255;
  rgba[idx + 1] = 0;
  rgba[idx + 2] = 0;
  rgba[idx + 3] = 255;
  return rgba;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Template crop geometry cache", () => {
  let previewMod: typeof import("@/components/editor/preview/nativeTextPreview");

  beforeEach(async () => {
    previewMod = await import(
      "@/components/editor/preview/nativeTextPreview"
    );
    // Reset cache between each test for isolation.
    previewMod._clearTemplateCropGeometryCache();
  });

  // ── Exports ───────────────────────────────────────────────────────────────

  it("_clearTemplateCropGeometryCache is exported and callable without throwing", () => {
    expect(typeof previewMod._clearTemplateCropGeometryCache).toBe("function");
    expect(() => previewMod._clearTemplateCropGeometryCache()).not.toThrow();
  });

  it("getTemplateCropCacheKey is exported", () => {
    expect(typeof previewMod.getTemplateCropCacheKey).toBe("function");
  });

  it("cropTemplateAsset is exported", () => {
    expect(typeof previewMod.cropTemplateAsset).toBe("function");
  });

  // ── getTemplateCropCacheKey ───────────────────────────────────────────────

  it("returns null for a layer without templateId", () => {
    const layer = makeLayer({ templateId: undefined, clipKind: "text" as any });
    expect(previewMod.getTemplateCropCacheKey(layer)).toBeNull();
  });

  it("returns templateRevisionId when present (highest priority)", () => {
    const layer = makeLayer({
      templateId: "tmpl-1",
      templateRevisionId: "rev-42",
      templateContentHash: "hash-abc",
    });
    expect(previewMod.getTemplateCropCacheKey(layer)).toBe("rev-42");
  });

  it("falls back to templateContentHash when revisionId is absent", () => {
    const layer = makeLayer({
      templateId: "tmpl-1",
      templateRevisionId: undefined,
      templateContentHash: "hash-abc",
    });
    expect(previewMod.getTemplateCropCacheKey(layer)).toBe("hash-abc");
  });

  it("falls back to templateId as last resort", () => {
    const layer = makeLayer({
      templateId: "tmpl-fallback",
      templateRevisionId: undefined,
      templateContentHash: undefined,
    });
    expect(previewMod.getTemplateCropCacheKey(layer)).toBe("tmpl-fallback");
  });

  // ── cropTemplateAsset — geometry ──────────────────────────────────────────

  it("returns null for a fully-transparent pixel buffer", () => {
    const transparent = new Uint8ClampedArray(100 * 50 * 4);
    const result = previewMod.cropTemplateAsset(
      transparent,
      100,
      50,
      "crop-transparent",
    );
    expect(result).toBeNull();
  });

  it("returns a cropped result for a buffer with one visible pixel", () => {
    const rgba = makeRgbaWithPixelAt(100, 50, 20, 10);
    const result = previewMod.cropTemplateAsset(rgba, 100, 50, "crop-single");
    expect(result).not.toBeNull();
    expect(result!.width).toBeGreaterThan(0);
    expect(result!.height).toBeGreaterThan(0);
    expect(result!.width).toBeLessThanOrEqual(100);
    expect(result!.height).toBeLessThanOrEqual(50);
  });

  it("cropped dimensions are smaller than the original canvas", () => {
    // Single visible pixel far from edges — crop should be much smaller
    const rgba = makeRgbaWithPixelAt(200, 100, 100, 50);
    const result = previewMod.cropTemplateAsset(rgba, 200, 100, "crop-small");
    expect(result).not.toBeNull();
    expect(result!.width).toBeLessThan(200);
    expect(result!.height).toBeLessThan(100);
  });

  it("offsetX / offsetY are within canvas bounds", () => {
    const rgba = makeRgbaWithPixelAt(100, 50, 30, 20);
    const result = previewMod.cropTemplateAsset(rgba, 100, 50, "crop-offset");
    expect(result).not.toBeNull();
    expect(result!.offsetX).toBeGreaterThanOrEqual(0);
    expect(result!.offsetY).toBeGreaterThanOrEqual(0);
    expect(result!.offsetX).toBeLessThan(100);
    expect(result!.offsetY).toBeLessThan(50);
  });

  // ── Cache hit — geometry reuse ────────────────────────────────────────────

  it("second call with same cache key returns same geometry without re-scanning", () => {
    const rgba1 = makeRgbaWithPixelAt(100, 50, 20, 10);
    const result1 = previewMod.cropTemplateAsset(rgba1, 100, 50, "cache-hit");

    // Different pixel data, same cache key — geometry must come from cache
    const rgba2 = makeRgbaWithPixelAt(100, 50, 80, 40);
    const result2 = previewMod.cropTemplateAsset(rgba2, 100, 50, "cache-hit");

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    // Geometry identical — cached from first scan
    expect(result1!.width).toBe(result2!.width);
    expect(result1!.height).toBe(result2!.height);
    expect(result1!.offsetX).toBe(result2!.offsetX);
    expect(result1!.offsetY).toBe(result2!.offsetY);
    // But pixel content is different (cropped from different source data)
    const pixelsDiffer = result1!.rgba.some((v, i) => v !== result2!.rgba[i]);
    expect(pixelsDiffer).toBe(true);
  });

  it("_clearTemplateCropGeometryCache forces a fresh scan on next call", () => {
    const rgba1 = makeRgbaWithPixelAt(100, 50, 5, 5); // top-left region
    const result1 = previewMod.cropTemplateAsset(rgba1, 100, 50, "cache-clear");
    expect(result1).not.toBeNull();

    // Clear cache then use pixel in the opposite corner
    previewMod._clearTemplateCropGeometryCache();
    const rgba2 = makeRgbaWithPixelAt(100, 50, 95, 45); // bottom-right region
    const result2 = previewMod.cropTemplateAsset(rgba2, 100, 50, "cache-clear");
    expect(result2).not.toBeNull();

    // After cache clear, geometry reflects the new pixel position
    expect(result1!.offsetX).not.toBe(result2!.offsetX);
    expect(result1!.offsetY).not.toBe(result2!.offsetY);
  });

  // ── Different cache keys → independent geometry ───────────────────────────

  it("different cache keys scan independently", () => {
    const rgbaA = makeRgbaWithPixelAt(100, 50, 0, 0);   // top-left
    const rgbaB = makeRgbaWithPixelAt(100, 50, 99, 49); // bottom-right

    const resultA = previewMod.cropTemplateAsset(rgbaA, 100, 50, "key-TL");
    const resultB = previewMod.cropTemplateAsset(rgbaB, 100, 50, "key-BR");

    expect(resultA).not.toBeNull();
    expect(resultB).not.toBeNull();
    // Offsets must differ since the visible pixels are in opposite corners
    const sameOffset =
      resultA!.offsetX === resultB!.offsetX &&
      resultA!.offsetY === resultB!.offsetY;
    expect(sameOffset).toBe(false);
  });

  // ── Result Uint8ClampedArray type ─────────────────────────────────────────

  it("returned rgba is a Uint8ClampedArray", () => {
    const rgba = makeRgbaWithPixelAt(100, 50, 50, 25);
    const result = previewMod.cropTemplateAsset(rgba, 100, 50, "type-check");
    expect(result).not.toBeNull();
    expect(result!.rgba).toBeInstanceOf(Uint8ClampedArray);
  });

  it("cropped rgba length matches width × height × 4", () => {
    const rgba = makeRgbaWithPixelAt(100, 50, 50, 25);
    const result = previewMod.cropTemplateAsset(rgba, 100, 50, "length-check");
    expect(result).not.toBeNull();
    expect(result!.rgba.length).toBe(result!.width * result!.height * 4);
  });
});
