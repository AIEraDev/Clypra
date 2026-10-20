import { describe, it, expect, vi } from "vitest";
import {
  effectBleed,
  hasTextClipContentTransformDrift,
  measureTextEffectContentBounds,
  calculateTextClipAuthoredSize,
  calculateTextClipSize,
  createTextClip,
} from "../textClip";
import type { TextEffectDefinition } from "@clypra-studio/engine";

// Mock @clypra-studio/engine
vi.mock("@clypra-studio/engine", () => {
  class MockTemplateRenderer {
    updateLayer = vi.fn();
    drawFrame = vi.fn();
    getContentBounds = vi.fn(() => ({ x: 10, y: 10, width: 200, height: 100 }));
  }
  return {
    TemplateRenderer: MockTemplateRenderer,
    builtInPresets: [],
  };
});

// Mock stores
vi.mock("../../features/text-effects/store/effectsStore", () => {
  return {
    useEffectsStore: {
      getState: vi.fn(() => ({ definitions: {} })),
    },
  };
});

vi.mock("../../features/text-templates/templateStore", () => {
  return {
    useTemplateStore: {
      getState: vi.fn(() => ({ templates: [] })),
    },
  };
});

describe("Text Clip Utilities", () => {
  describe("effectBleed", () => {
    it("should calculate bleed for explicit stroke styles", () => {
      const bleed = effectBleed({
        stroke: { width: 5 },
      });
      // 5 * 1.15 = 5.75 rounded up is 6
      expect(bleed.x).toBe(6);
      expect(bleed.y).toBe(6);
    });

    it("should calculate bleed for explicit shadow styles", () => {
      const bleed = effectBleed({
        shadow: { blur: 4, offsetX: 3, offsetY: 2 },
      });
      // x: Math.ceil((3 + 4) * 1.15) = Math.ceil(7 * 1.15) = 9
      // y: Math.ceil((2 + 4) * 1.15) = Math.ceil(6 * 1.15) = 7
      expect(bleed.x).toBe(9);
      expect(bleed.y).toBe(7);
    });

    it("should use boundingBox declarations from definition if present", () => {
      const mockEffect: TextEffectDefinition = {
        id: "glow-effect",
        boundingBox: {
          mode: "ink",
          paddingX: 35,
          paddingY: 25,
        },
      } as any;

      const bleed = effectBleed({
        effectDefinition: mockEffect,
      });

      expect(bleed.x).toBe(35);
      expect(bleed.y).toBe(25);
    });

    it("CLY-BUG-002: should calculate bleed for background padding and bubble presets", () => {
      const bleedCustomBg = effectBleed({
        background: { padding: 30 },
      });
      expect(bleedCustomBg.x).toBeGreaterThanOrEqual(30);
      expect(bleedCustomBg.y).toBeGreaterThanOrEqual(30);

      const bleedBubble = effectBleed({
        background: { padding: 16, bubblePresetId: "bubble-speech" },
      });
      expect(bleedBubble.x).toBeGreaterThanOrEqual(32);
      expect(bleedBubble.y).toBeGreaterThanOrEqual(36);
    });
  });

  describe("measureTextEffectContentBounds & calculateTextClipSize", () => {
    it("CLY-TEXT-041: measures the evaluated text transform so uppercase panel glyphs cannot escape their layout", () => {
      const offscreenFactory = vi.fn(function () {
        return {
          getContext: () => ({
            font: "",
            letterSpacing: "0px",
            measureText: (value: string) => ({
              width: value === value.toUpperCase() ? 640 : 420,
              actualBoundingBoxAscent: 80,
              actualBoundingBoxDescent: 20,
            }),
          }),
        };
      });
      vi.stubGlobal("OffscreenCanvas", offscreenFactory);

      try {
        const lowercase = calculateTextClipSize({
          text: "Hey guys,\nAbdulkabir",
          fontFamily: "Inter Variable",
          fontSize: 96,
          background: { color: "#55565b", padding: 8, borderRadius: 0, width: 18, height: 12 },
          canvasWidth: 1920,
        });
        const uppercase = calculateTextClipSize({
          text: "Hey guys,\nAbdulkabir",
          textTransform: "uppercase",
          fontFamily: "Inter Variable",
          fontSize: 96,
          background: { color: "#55565b", padding: 8, borderRadius: 0, width: 18, height: 12 },
          canvasWidth: 1920,
        });

        expect(uppercase.width).toBeGreaterThan(lowercase.width);
        expect(offscreenFactory).toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("CLY-TEXT-042: derives a resized text base from content, never the dragged display rectangle", () => {
      const clip = createTextClip({
        trackId: "track-text-1",
        startTime: 0,
        text: "HEY GUYS,\nABDULKABIR",
        canvasWidth: 1920,
        canvasHeight: 1080,
        fontSize: 96,
        background: {
          color: "#55565b",
          padding: 8,
          borderRadius: 0,
        },
      });
      const displayWidth = 516;
      const displayHeight = 192;
      const resized = calculateTextClipAuthoredSize(
        { ...clip, width: displayWidth, height: displayHeight },
        1920,
        { fontSize: 48 },
      );

      // A fit-content background's authored panel is determined by the new
      // glyph layout. The display dimensions remain a compositor transform.
      expect(resized.width).not.toBe(displayWidth);
      expect(resized.height).not.toBe(displayHeight);
      expect(resized.bounds.source).toBe("panel");
      expect(
        hasTextClipContentTransformDrift(
          {
            ...clip,
            fontSize: 48,
            width: displayWidth,
            height: displayHeight,
            baseWidth: resized.width,
            baseHeight: resized.height,
          },
          1920,
          1080,
        ),
      ).toBe(false);
    });

    it("should compute sensible dimensions based on font size and letter spacing", () => {
      const options = {
        text: "Clypra Editor",
        fontFamily: "Inter",
        fontSize: 48,
        bold: true,
        letterSpacing: 2,
        canvasWidth: 1920,
      };

      const result = calculateTextClipSize(options);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.bounds.source).toBe("plain");
    });

    it("should apply max width limits for caption roles", () => {
      const options = {
        text: "This is an extremely long subtitle string designed to exceed the caption wrap safe area boundaries on a typical preview screen size.",
        fontFamily: "Inter",
        fontSize: 32,
        canvasWidth: 1000,
        textRole: "caption" as const,
      };

      const result = calculateTextClipSize(options);
      // Caption max width is canvasWidth * 0.95 = 950
      expect(result.width).toBeLessThanOrEqual(950);
    });

    it("should honor an explicit max width and preserve multiline height", () => {
      const singleLine = calculateTextClipSize({
        text: "A long line of editable text",
        fontFamily: "Inter",
        fontSize: 48,
        canvasWidth: 1920,
        maxWidth: 320,
      });
      const multiline = calculateTextClipSize({
        text: "A long line of editable text\nSecond line",
        fontFamily: "Inter",
        fontSize: 48,
        canvasWidth: 1920,
        maxWidth: 320,
      });

      expect(singleLine.width).toBeLessThanOrEqual(320);
      expect(multiline.width).toBeLessThanOrEqual(320);
      expect(multiline.height).toBeGreaterThan(singleLine.height);
    });
  });

  describe("createTextClip", () => {
    it("should build a valid TextClip object structure with proper positional coordinates", () => {
      const clip = createTextClip({
        trackId: "track-text-1",
        startTime: 2.0,
        duration: 4.5,
        text: "Interactive Title",
        canvasWidth: 1920,
        canvasHeight: 1080,
        fontSize: 64,
        position: "center",
      });

      expect(clip.id).toMatch(/^text-clip-/);
      expect(clip.kind).toBe("text");
      expect(clip.trackId).toBe("track-text-1");
      expect(clip.startTime).toBe(2.0);
      expect(clip.duration).toBe(4.5);
      expect(clip.width).toBeGreaterThan(0);
      expect(clip.height).toBeGreaterThan(0);
    });
  });
});
