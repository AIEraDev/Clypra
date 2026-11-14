/**
 * Font Resolution Error & Export Enforcement Tests
 *
 * Verifies that:
 * 1. isSpecificFontFaceLoaded checks individual FontFace.status === "loaded"
 *    and rejects fonts.check() false positives.
 * 2. Missing/unloaded fonts throw ExportFontResolutionError during export phase
 *    on both main thread and worker paths.
 * 3. Visible playback preview gracefully degrades to fallback without throwing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ExportFontResolutionError,
  isSpecificFontFaceLoaded,
} from "../fontErrors";
import { getFontLoader, resetFontLoader } from "../FontLoader";
import type { EvaluatedTextLayer } from "@/core/evaluation/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

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

const mockCtx = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  measureText: vi.fn().mockReturnValue({ width: 200 }),
  getImageData: vi.fn().mockReturnValue({
    data: new Uint8ClampedArray(4),
    width: 1,
    height: 1,
  }),
};

class MockOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return mockCtx;
  }
}

if (typeof globalThis.OffscreenCanvas === "undefined") {
  // @ts-ignore
  globalThis.OffscreenCanvas = MockOffscreenCanvas;
}

function makeSampleLayer(overrides: Partial<EvaluatedTextLayer> = {}): EvaluatedTextLayer {
  return {
    layerId: "layer-export-test",
    clipId: "clip-export-test",
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
    text: "Sample Export Caption",
    fontFamily: "NonExistentFont",
    fontSize: 48,
    fontWeight: 400,
    fontStyle: "normal",
    color: "#ffffff",
    textAlign: "center",
    verticalAlign: "middle",
    lineHeight: 1.25,
    letterSpacing: 0,
    ...overrides,
  };
}

describe("Font Resolution & Export Enforcement", () => {
  beforeEach(() => {
    resetFontLoader();
    vi.clearAllMocks();
  });

  describe("isSpecificFontFaceLoaded", () => {
    it("returns false when fontFaces set is null or undefined", () => {
      expect(isSpecificFontFaceLoaded(null, "Inter")).toBe(false);
      expect(isSpecificFontFaceLoaded(undefined, "Inter")).toBe(false);
    });

    it("returns false when the requested font family is not in the set even if fonts.check would pass", () => {
      // fonts.check() might return true because system fallback matches
      const fakeSet = new Set<FontFace>([
        { family: "Arial", status: "loaded" } as FontFace,
      ]);
      expect(isSpecificFontFaceLoaded(fakeSet as unknown as FontFaceSet, "MissingFont")).toBe(false);
    });

    it("returns false when the font is in the set but status is loading or error", () => {
      const fakeSet = new Set<FontFace>([
        { family: "SpecialFont", status: "loading" } as FontFace,
      ]);
      expect(isSpecificFontFaceLoaded(fakeSet as unknown as FontFaceSet, "SpecialFont")).toBe(false);

      const fakeSetError = new Set<FontFace>([
        { family: "SpecialFont", status: "error" } as FontFace,
      ]);
      expect(isSpecificFontFaceLoaded(fakeSetError as unknown as FontFaceSet, "SpecialFont")).toBe(false);
    });

    it("returns true when font face status is loaded (handles quotes and case)", () => {
      const fakeSet = new Set<FontFace>([
        { family: '"Custom Sans"', status: "loaded" } as FontFace,
      ]);
      expect(isSpecificFontFaceLoaded(fakeSet as unknown as FontFaceSet, "custom sans")).toBe(true);
      expect(isSpecificFontFaceLoaded(fakeSet as unknown as FontFaceSet, "'Custom Sans'")).toBe(true);
    });
  });

  describe("ExportFontResolutionError class", () => {
    it("has correct name, code, and fontFamily attributes", () => {
      const err = new ExportFontResolutionError("MyFont", "network offline");
      expect(err.name).toBe("ExportFontResolutionError");
      expect(err.code).toBe("ExportFontResolutionError");
      expect(err.fontFamily).toBe("MyFont");
      expect(err.message).toContain('Font "MyFont" could not be resolved');
      expect(err.message).toContain("network offline");
    });
  });

  describe("rasterizeTextLayerForNative export vs preview enforcement", () => {
    it("throws ExportFontResolutionError during phase === 'export' when font cannot be loaded", async () => {
      const { rasterizeTextLayerForNative } = await import(
        "@/components/editor/preview/nativeTextPreview"
      );

      // Force getFontLoader().ensureFont to fail / return not loaded
      const loader = getFontLoader();
      vi.spyOn(loader, "ensureFont").mockResolvedValue({
        font: { family: "UnloadableFont", weight: "normal", style: "normal" },
        loaded: false,
        loadTimeMs: 10,
        error: "404 Not Found",
      });
      vi.spyOn(loader, "isLoaded").mockReturnValue(false);

      const layer = makeSampleLayer({ fontFamily: "UnloadableFont" });

      await expect(
        rasterizeTextLayerForNative(layer, { phase: "export" }),
      ).rejects.toThrow(ExportFontResolutionError);
    });

    it("does NOT throw during phase === 'visible-playback', falling back smoothly", async () => {
      const { rasterizeTextLayerForNative } = await import(
        "@/components/editor/preview/nativeTextPreview"
      );

      const loader = getFontLoader();
      vi.spyOn(loader, "ensureFont").mockResolvedValue({
        font: { family: "SlowPreviewFont", weight: "normal", style: "normal" },
        loaded: false,
        loadTimeMs: 10,
        error: "Timeout",
      });
      vi.spyOn(loader, "isLoaded").mockReturnValue(false);

      const layer = makeSampleLayer({ fontFamily: "SlowPreviewFont" });

      // In playback phase, should resolve without throwing (fallback font path)
      const asset = await rasterizeTextLayerForNative(layer, { phase: "visible-playback" });
      expect(asset).toBeDefined();
      expect(asset.width).toBeGreaterThan(0);
    });
  });

  describe("TemplateRasterizerWorkerClient export error surfacing", () => {
    it("rejects with ExportFontResolutionError when worker sends FRAME_FAILED with ExportFontResolutionError", async () => {
      const { TemplateRasterizerWorkerClient } = await import(
        "@/core/render/templateRasterizerWorkerClient"
      );

      const client = new TemplateRasterizerWorkerClient();

      // Simulate a worker message arriving with ExportFontResolutionError
      let messageListener: ((e: MessageEvent) => void) | undefined;
      const fakeWorker = {
        postMessage: vi.fn(),
        addEventListener: vi.fn((type: string, listener: any) => {
          if (type === "message") messageListener = listener;
        }),
        removeEventListener: vi.fn(),
        terminate: vi.fn(),
      };

      // @ts-ignore
      vi.spyOn(client as any, "ensureWorker").mockReturnValue(true);
      // @ts-ignore
      client["worker"] = fakeWorker;

      // Trigger rasterizeEffect with phase = "export"
      const layer = makeSampleLayer({ styleId: "custom-effect" });
      const renderPromise = client.rasterizeEffect(
        layer,
        { canvas: {} },
        800,
        200,
        "test-raster-key",
        "export",
      );

      // Attach reject assertion handler before triggering the rejection
      const assertion = expect(renderPromise).rejects.toThrow(
        ExportFontResolutionError,
      );

      // Simulate worker postMessage response
      expect(fakeWorker.postMessage).toHaveBeenCalledTimes(1);
      const sentMsg = fakeWorker.postMessage.mock.calls[0][0];

      // Worker replies with FRAME_FAILED containing ExportFontResolutionError
      // @ts-ignore
      client["handleMessage"]({
        data: {
          type: "FRAME_FAILED",
          id: sentMsg.id,
          error:
            'ExportFontResolutionError: Font "UnbundledWorkerFont" is not bundled in worker',
        },
      } as MessageEvent);

      await assertion;
    });
  });
});
