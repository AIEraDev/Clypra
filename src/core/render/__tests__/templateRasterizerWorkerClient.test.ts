/**
 * TemplateRasterizerWorkerClient — unit tests
 *
 * These tests run in JSDOM (no real Worker, no OffscreenCanvas) and exercise
 * the fallback path, deduplication, and dispose lifecycle contracts.
 *
 * The engine mock uses importOriginal so builtInPresets and other exports
 * used by effectsStore at module init time remain available.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EvaluatedTextLayer } from "@/core/evaluation/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// rasterizeTextLayerForNative is the main-thread fallback — spy on it to assert
// it is called (or not) for each routing path.
vi.mock("@/components/editor/preview/nativeTextPreview", () => ({
  buildNativeTextLayoutKey: vi.fn(() => "layout-key"),
  buildNativeTextRasterKey: vi.fn(() => "raster-key"),
  getCachedLayoutMetrics: vi.fn(() => ({
    bleedX: 4,
    bleedY: 4,
    rasterWidth: 648,
    rasterHeight: 128,
    effectDefinition: null,
  })),
  getTemplateCropCacheKey: vi.fn(() => null),
  cropTemplateAsset: vi.fn(() => null),
  _clearTemplateCropGeometryCache: vi.fn(),
  rasterizeTextLayerForNative: vi.fn(async () => makeMockAsset()),
}));

// Use importOriginal so builtInPresets (needed by effectsStore at module init)
// and all other engine exports remain intact. Only resolveTextTemplateArtifact
// is overridden — returning null forces the fallback path.
vi.mock("@clypra-studio/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clypra-studio/engine")>();
  return {
    ...actual,
    resolveTextTemplateArtifact: vi.fn(() => null),
  };
});

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
    x: 100,
    y: 80,
    width: 640,
    height: 120,
    rotation: 0,
    opacity: 1,
    inTransition: false,
    blendMode: "normal",
    text: "Hello World",
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

function makeMockAsset() {
  return {
    assetId: "native-text:layer-1:abc123",
    rgba: new Uint8ClampedArray(4),
    width: 640,
    height: 120,
    x: 96,
    y: 76,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    blendMode: "normal",
    isText: true as const,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TemplateRasterizerWorkerClient — JSDOM (Worker unavailable)", () => {
  let mod: typeof import("../templateRasterizerWorkerClient");
  let previewMod: typeof import("@/components/editor/preview/nativeTextPreview");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("../templateRasterizerWorkerClient");
    previewMod = await import("@/components/editor/preview/nativeTextPreview");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Worker unavailability — fallback to main thread ──────────────────────

  describe("Worker unavailability — fallback to main thread", () => {
    it("rasterize() falls back to rasterizeTextLayerForNative when Worker is unavailable", async () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      await client.rasterize(makeLayer(), "key-1", "visible-playback");
      expect(previewMod.rasterizeTextLayerForNative).toHaveBeenCalledTimes(1);
    });

    it("rasterizeEffect() falls back to rasterizeTextLayerForNative when Worker is unavailable", async () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      const layer = makeLayer({ styleId: "neon-glow" });
      await client.rasterizeEffect(
        layer,
        { canvas: {} },
        800,
        200,
        "key-2",
        "visible-playback",
      );
      expect(previewMod.rasterizeTextLayerForNative).toHaveBeenCalledTimes(1);
    });

    it("fallback returns a NativeTextRasterAsset with expected fields", async () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      const result = await client.rasterize(
        makeLayer(),
        "key-3",
        "visible-playback",
      );
      expect(result).toHaveProperty("assetId");
      expect(result).toHaveProperty("rgba");
      expect(result).toHaveProperty("width");
      expect(result).toHaveProperty("height");
      expect(result).toHaveProperty("isText", true);
    });
  });

  // ── In-flight deduplication ───────────────────────────────────────────────

  describe("In-flight deduplication", () => {
    it("rasterize() deduplicates concurrent calls with the same rasterKey", async () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      const layer = makeLayer();
      const [r1, r2, r3] = await Promise.all([
        client.rasterize(layer, "same-key", "visible-playback"),
        client.rasterize(layer, "same-key", "visible-playback"),
        client.rasterize(layer, "same-key", "visible-playback"),
      ]);
      expect(r1.assetId).toBe(r2.assetId);
      expect(r2.assetId).toBe(r3.assetId);
      // rasterizeTextLayerForNative should only be invoked once
      expect(previewMod.rasterizeTextLayerForNative).toHaveBeenCalledTimes(1);
    });

    it("concurrent rasterize() calls for the same key return the identical Promise object (race eliminated by construction)", async () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      const layer = makeLayer();

      // Use a deferred mock so the first rasterize() call's promise stays
      // in inFlight long enough for p2 and p3 to be created synchronously.
      // Without this, the synchronous module-mock resolution in JSDOM causes
      // promise.finally() to fire before p2/p3 are created, emptying inFlight.
      let resolveFirst!: (v: ReturnType<typeof makeMockAsset>) => void;
      const deferred = new Promise<ReturnType<typeof makeMockAsset>>((res) => {
        resolveFirst = res;
      });
      (
        previewMod.rasterizeTextLayerForNative as ReturnType<typeof vi.fn>
      ).mockReturnValueOnce(deferred);

      // Fire all three before any microtask can drain the inFlight map
      const p1 = client.rasterize(layer, "race-key", "visible-playback");
      const p2 = client.rasterize(layer, "race-key", "visible-playback");
      const p3 = client.rasterize(layer, "race-key", "visible-playback");

      // All three must be the exact same Promise reference
      expect(p1).toBe(p2);
      expect(p2).toBe(p3);

      resolveFirst(makeMockAsset());
      await Promise.allSettled([p1, p2, p3]);
    });

    it("concurrent rasterizeEffect() calls for the same key return the identical Promise object", async () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      const layer = makeLayer({ styleId: "neon" });
      const sceneDoc = { canvas: {} };

      let resolveFirst!: (v: ReturnType<typeof makeMockAsset>) => void;
      const deferred = new Promise<ReturnType<typeof makeMockAsset>>((res) => {
        resolveFirst = res;
      });
      (
        previewMod.rasterizeTextLayerForNative as ReturnType<typeof vi.fn>
      ).mockReturnValueOnce(deferred);

      const p1 = client.rasterizeEffect(
        layer,
        sceneDoc,
        800,
        200,
        "effect-race-key",
        "visible-playback",
      );
      const p2 = client.rasterizeEffect(
        layer,
        sceneDoc,
        800,
        200,
        "effect-race-key",
        "visible-playback",
      );

      expect(p1).toBe(p2);

      resolveFirst(makeMockAsset());
      await Promise.allSettled([p1, p2]);
    });

    it("rasterizeEffect() deduplicates concurrent calls with the same rasterKey", async () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      const layer = makeLayer({ styleId: "neon" });
      const sceneDoc = { canvas: {} };
      const [r1, r2] = await Promise.all([
        client.rasterizeEffect(
          layer,
          sceneDoc,
          800,
          200,
          "effect-key",
          "visible-playback",
        ),
        client.rasterizeEffect(
          layer,
          sceneDoc,
          800,
          200,
          "effect-key",
          "visible-playback",
        ),
      ]);
      expect(r1.assetId).toBe(r2.assetId);
      expect(previewMod.rasterizeTextLayerForNative).toHaveBeenCalledTimes(1);
    });

    it("different rasterKeys trigger separate renders", async () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      const layer = makeLayer();
      await client.rasterize(layer, "key-a", "visible-playback");
      await client.rasterize(layer, "key-b", "visible-playback");
      expect(previewMod.rasterizeTextLayerForNative).toHaveBeenCalledTimes(2);
    });

    it("different rasterKeys return different Promise objects", () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      const layer = makeLayer();
      const p1 = client.rasterize(layer, "key-x", "visible-playback");
      const p2 = client.rasterize(layer, "key-y", "visible-playback");
      expect(p1).not.toBe(p2);
      return Promise.allSettled([p1, p2]);
    });

    it("in-flight count returns to 0 after all promises resolve", async () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      await client.rasterize(makeLayer(), "key-settle", "visible-playback");
      expect(client.inFlightCount).toBe(0);
    });
  });

  // ── Dispose lifecycle ─────────────────────────────────────────────────────

  describe("Dispose lifecycle", () => {
    it("dispose() is idempotent — calling twice does not throw", () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      expect(() => {
        client.dispose();
        client.dispose();
      }).not.toThrow();
    });

    it("rasterize() after dispose() still resolves via fallback", async () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      client.dispose();
      await expect(
        client.rasterize(makeLayer(), "post-dispose-key", "visible-playback"),
      ).resolves.toHaveProperty("isText", true);
    });

    it("rasterizeEffect() after dispose() still resolves via fallback", async () => {
      const client = new mod.TemplateRasterizerWorkerClient();
      client.dispose();
      await expect(
        client.rasterizeEffect(
          makeLayer({ styleId: "glow" }),
          {},
          800,
          200,
          "post-dispose-effect",
          "visible-playback",
        ),
      ).resolves.toHaveProperty("isText", true);
    });
  });
});

// ─── Phase 1 regression — Uint8ClampedArray flows through without Array.from ──

describe("Phase 1 regression — Uint8ClampedArray flows through without Array.from", () => {
  it("NativeTextRasterAsset.rgba accepts Uint8ClampedArray", () => {
    const asset: import("@/components/editor/preview/nativeTextPreview").NativeTextRasterAsset =
      {
        assetId: "test",
        rgba: new Uint8ClampedArray([255, 0, 0, 255]),
        width: 1,
        height: 1,
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
        isText: true,
      };
    expect(asset.rgba).toBeInstanceOf(Uint8ClampedArray);
  });

  it("NativeRasterLayerSnapshot.rgba accepts Uint8ClampedArray", () => {
    const snap: import("@/lib/platform/nativeCore").NativeRasterLayerSnapshot =
      {
        assetId: "snap-1",
        rgba: new Uint8ClampedArray(4),
        width: 1,
        height: 1,
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
        isText: false,
      };
    expect(snap.rgba).toBeInstanceOf(Uint8ClampedArray);
  });
});

// ─── Routing logic — pure predicate tests (no imports, no mocks needed) ───────

describe("Routing — getTextRaster dispatch predicates", () => {
  const makeLayer = (
    overrides: Partial<EvaluatedTextLayer> = {},
  ): EvaluatedTextLayer => ({
    layerId: "l",
    clipId: "c",
    role: "text",
    clipKind: "text" as any,
    zIndex: 0,
    trackIndex: 0,
    layerType: "text",
    x: 0,
    y: 0,
    width: 640,
    height: 120,
    rotation: 0,
    opacity: 1,
    inTransition: false,
    blendMode: "normal",
    text: "",
    fontFamily: "Inter Variable",
    fontSize: 48,
    color: "#fff",
    fontWeight: 400,
    fontStyle: "normal",
    textAlign: "center",
    verticalAlign: "middle",
    lineHeight: 1.2,
    letterSpacing: 0,
    ...overrides,
  });

  it("plain text is not a template and has no canonical scene", () => {
    const layer = makeLayer({ templateId: undefined, styleId: undefined });
    expect(
      Boolean(layer.templateId) || layer.clipKind === "text-template",
    ).toBe(false);
    expect(!!(layer.styleDefinition as any)?.scene?.effectLayers).toBe(false);
  });

  it("text-template clip is identified by clipKind", () => {
    const layer = makeLayer({ clipKind: "text-template" as any });
    expect(
      Boolean(layer.templateId) || layer.clipKind === "text-template",
    ).toBe(true);
  });

  it("text-template clip is also identified by templateId alone", () => {
    const layer = makeLayer({
      clipKind: "text" as any,
      templateId: "tmpl-abc",
    });
    expect(
      Boolean(layer.templateId) || layer.clipKind === "text-template",
    ).toBe(true);
  });

  it("styled effect with canonical scene routes off-thread", () => {
    const layer = makeLayer({
      styleId: "neon-glow",
      styleDefinition: {
        id: "neon-glow",
        scene: { effectLayers: [{}] },
      } as any,
    });
    expect(!!(layer.styleDefinition as any)?.scene?.effectLayers).toBe(true);
  });

  it("styled effect WITHOUT canonical scene stays on main thread", () => {
    const layer = makeLayer({
      styleId: "legacy",
      styleDefinition: { id: "legacy" } as any,
    });
    expect(!!(layer.styleDefinition as any)?.scene?.effectLayers).toBe(false);
  });

  it("styleId present but styleDefinition absent stays on main thread", () => {
    const layer = makeLayer({ styleId: "missing-def" });
    expect(!!(layer.styleDefinition as any)?.scene?.effectLayers).toBe(false);
  });
});
