/**
 * Font Loader Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { FontLoader, getFontLoader, resetFontLoader } from "../FontLoader";

// Mock document.fonts API
const mockFonts = {
  check: vi.fn(() => true),
  load: vi.fn(() => Promise.resolve()),
  ready: Promise.resolve(),
};

if (typeof document !== "undefined") {
  Object.defineProperty(document, "fonts", {
    value: mockFonts,
    writable: true,
    configurable: true,
  });
} else {
  // @ts-ignore
  global.document = { fonts: mockFonts };
}

describe("FontLoader", () => {
  let loader: FontLoader;

  beforeEach(() => {
    resetFontLoader();
    loader = new FontLoader();
    vi.clearAllMocks();
  });

  describe("ensureFont", () => {
    it("should load a font successfully", async () => {
      const result = await loader.ensureFont({
        family: "Arial",
        weight: "normal",
        style: "normal",
      });

      expect(result.loaded).toBe(true);
      expect(result.font.family).toBe("Arial");
    });

    it("should cache loaded fonts", async () => {
      const descriptor = {
        family: "Arial",
        weight: "normal" as const,
        style: "normal" as const,
      };

      const result1 = await loader.ensureFont(descriptor);
      const result2 = await loader.ensureFont(descriptor);

      expect(result1.loaded).toBe(true);
      expect(result2.loaded).toBe(true);
      expect(result2.loadTimeMs).toBe(0); // Cached
    });

    it("should handle font weights", async () => {
      const result = await loader.ensureFont({
        family: "Arial",
        weight: "bold",
        style: "normal" as const,
      });

      expect(result.loaded).toBe(true);
    });

    it("should handle numeric font weights", async () => {
      const result = await loader.ensureFont({
        family: "Arial",
        weight: 700,
        style: "normal" as const,
      });

      expect(result.loaded).toBe(true);
    });
  });

  describe("ensureFonts", () => {
    it("should load multiple fonts", async () => {
      const results = await loader.ensureFonts([
        { family: "Arial", weight: "normal", style: "normal" as const },
        { family: "Arial", weight: "bold", style: "normal" as const },
        { family: "Arial", weight: "normal", style: "italic" as const },
      ]);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.loaded)).toBe(true);
    });
  });

  describe("isLoaded", () => {
    it("should return true for loaded fonts", async () => {
      const descriptor = {
        family: "Arial",
        weight: "normal" as const,
        style: "normal" as const,
      };

      await loader.ensureFont(descriptor);

      expect(loader.isLoaded(descriptor)).toBe(true);
    });

    it("should return false for unloaded fonts", () => {
      expect(
        loader.isLoaded({
          family: "NonExistentFont",
          weight: "normal",
          style: "normal",
        }),
      ).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return loading statistics", async () => {
      await loader.ensureFont({
        family: "Arial",
        weight: "normal",
        style: "normal",
      });

      const stats = loader.getStats();

      expect(stats.loaded).toBeGreaterThan(0);
      expect(stats.loading).toBe(0);
    });
  });

  describe("global instance", () => {
    it("should return singleton instance", () => {
      const loader1 = getFontLoader();
      const loader2 = getFontLoader();

      expect(loader1).toBe(loader2);
    });

    it("should reset global instance", () => {
      const loader1 = getFontLoader();
      resetFontLoader();
      const loader2 = getFontLoader();

      expect(loader1).not.toBe(loader2);
    });
  });
});
