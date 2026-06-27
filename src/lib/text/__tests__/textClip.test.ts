import { describe, it, expect, vi } from "vitest";
import { effectBleed, measureTextEffectContentBounds, calculateTextClipSize, createTextClip } from "../textClip";
import type { TextEffectDefinition } from "@clypra/engine";

// Mock @clypra/engine
vi.mock("@clypra/engine", () => {
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
  });

  describe("measureTextEffectContentBounds & calculateTextClipSize", () => {
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
