/**
 * Tests for captionRasterizer (main-thread export rasterizer)
 *
 * Verifies that:
 * 1. rasterizeCaptionForExport succeeds and produces bounding-box cropped RGBA when font is loaded.
 * 2. rasterizeCaptionForExport blocks and throws ExportFontResolutionError when font cannot be resolved.
 * 3. Cropped dimensions and offsets are returned correctly for compositor placement.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { rasterizeCaptionForExport } from "../captionRasterizer";
import { ExportFontResolutionError } from "@/core/fonts/fontErrors";
import { getCaptionPreset } from "@clypra-studio/engine";
import type { CaptionCue } from "@clypra-studio/engine";

const SAMPLE_CUE: CaptionCue = {
  id: "test-cue-export",
  text: "Export Ready",
  startMs: 0,
  endMs: 2000,
  words: [
    { id: "w1", text: "Export", startMs: 0, endMs: 500, gapToNextMs: 50 },
    { id: "w2", text: "Ready", startMs: 550, endMs: 1200, gapToNextMs: 0 },
  ],
};

describe("captionRasterizer (export path)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws ExportFontResolutionError when preset font is not registered in document.fonts", async () => {
    // In jsdom environment, document.fonts by default has no custom fonts loaded.
    const customPreset = {
      ...getCaptionPreset("classic-subtitle")!,
      fontFamily: "NonExistentCaptionFont",
    };

    await expect(
      rasterizeCaptionForExport(SAMPLE_CUE, 0, customPreset, {
        canvasWidth: 1920,
        canvasHeight: 1080,
      }),
    ).rejects.toThrow(ExportFontResolutionError);
  });

  it("succeeds and produces cropped RGBA output when font is mock-registered and loaded", async () => {
    const preset = getCaptionPreset("classic-subtitle")!;

    // Mock document.fonts to report the preset font as loaded
    const fakeFace = {
      family: preset.fontFamily,
      status: "loaded" as const,
      load: vi.fn().mockResolvedValue({ status: "loaded" }),
    };

    const originalFonts = document.fonts;
    try {
      const mockFontSet = new Set([fakeFace]);
      Object.defineProperty(document, "fonts", {
        value: mockFontSet,
        configurable: true,
        writable: true,
      });

      const result = await rasterizeCaptionForExport(SAMPLE_CUE, 0, preset, {
        canvasWidth: 1920,
        canvasHeight: 1080,
      });

      expect(result).toBeDefined();
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.rgba).toBeInstanceOf(Uint8ClampedArray);
      expect(result.rgba.length).toBe(result.width * result.height * 4);
      // Absolute positioning offsets within canvas
      expect(typeof result.x).toBe("number");
      expect(typeof result.y).toBe("number");
    } finally {
      Object.defineProperty(document, "fonts", {
        value: originalFonts,
        configurable: true,
        writable: true,
      });
    }
  });

  it("throws ExportFontResolutionError if FontFace.load() rejects during export", async () => {
    const preset = getCaptionPreset("classic-subtitle")!;

    const failingFace = {
      family: preset.fontFamily,
      status: "unloaded" as const,
      load: vi.fn().mockRejectedValue(new Error("Network timeout")),
    };

    const originalFonts = document.fonts;
    try {
      const mockFontSet = new Set([failingFace]);
      Object.defineProperty(document, "fonts", {
        value: mockFontSet,
        configurable: true,
        writable: true,
      });

      await expect(
        rasterizeCaptionForExport(SAMPLE_CUE, 0, preset, {
          canvasWidth: 1920,
          canvasHeight: 1080,
        }),
      ).rejects.toThrow(ExportFontResolutionError);
    } finally {
      Object.defineProperty(document, "fonts", {
        value: originalFonts,
        configurable: true,
        writable: true,
      });
    }
  });
});
