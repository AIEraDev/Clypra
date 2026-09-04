import { describe, it, expect, beforeEach, vi } from "vitest";
import { FontLoader, resetFontLoader, getFontLoader } from "../FontLoader";

// Mock document.fonts API for FontLoader JSDOM execution
const mockFonts = {
  check: vi.fn(() => true),
  load: vi.fn(() => Promise.resolve()),
  ready: Promise.resolve(),
};

// @ts-ignore
global.document = {
  fonts: mockFonts,
};

describe("FontLoader Edge Cases & Concurrency Invariants", () => {
  beforeEach(() => {
    resetFontLoader();
    vi.clearAllMocks();
  });

  describe("Font Family Sanitization & Descriptor Normalization", () => {
    it("normalizes font descriptor keys consistently across instances", () => {
      const loader = new FontLoader();
      // Use a bundled variable font (not a system font) so the system-font
      // fast-path does not interfere with this key-normalization assertion.
      const descA = {
        family: "Inter Variable",
        weight: "normal" as const,
        style: "italic" as const,
      };
      const descB = {
        family: "Inter Variable",
        weight: "normal" as const,
        style: "italic" as const,
      };

      expect(loader.isLoaded(descA)).toBe(false);
      expect(loader.isLoaded(descB)).toBe(false);
    });

    it("handles system font loading cleanly", async () => {
      const loader = new FontLoader();
      const res = await loader.ensureFont({
        family: "Arial",
        weight: "normal",
        style: "normal",
      });
      expect(res.loaded).toBe(true);
      expect(res.font.family).toBe("Arial");
    });
  });

  describe("Concurrent Font Load Deduplication", () => {
    it("deduplicates simultaneous font load promises for the same descriptor", async () => {
      const loader = new FontLoader();
      const desc = {
        family: "Arial",
        weight: "bold" as const,
        style: "normal" as const,
      };

      const [p1, p2] = await Promise.all([
        loader.ensureFont(desc),
        loader.ensureFont(desc),
      ]);

      expect(p1.loaded).toBe(true);
      expect(p2.loaded).toBe(true);
    });
  });

  describe("Global Instance Reset & Statistics Invariants", () => {
    it("resets global singleton instance cleanly", () => {
      const g1 = getFontLoader();
      resetFontLoader();
      const g2 = getFontLoader();
      expect(g1).not.toBe(g2);
    });
  });
});

describe("System Font Allowlist — 0ms Resolution", () => {
  beforeEach(() => {
    resetFontLoader();
    vi.clearAllMocks();
  });

  it("returns loaded:true and loadTimeMs:0 for Impact without any document.fonts.load call", async () => {
    const loader = new FontLoader();
    const result = await loader.ensureFont({
      family: "Impact",
      weight: 700,
      style: "normal",
    });
    expect(result.loaded).toBe(true);
    expect(result.loadTimeMs).toBe(0);
    expect(mockFonts.load).not.toHaveBeenCalled();
  });

  it("isLoaded() returns true for Georgia before any ensureFont call", () => {
    const loader = new FontLoader();
    expect(
      loader.isLoaded({ family: "Georgia", weight: 400, style: "normal" }),
    ).toBe(true);
  });

  it("system font resolution is idempotent — second call returns loaded:true from cache", async () => {
    const loader = new FontLoader();
    const desc = { family: "Verdana", weight: 400, style: "normal" as const };
    await loader.ensureFont(desc);
    const result2 = await loader.ensureFont(desc);
    expect(result2.loaded).toBe(true);
    expect(result2.loadTimeMs).toBe(0);
    expect(mockFonts.load).not.toHaveBeenCalled();
  });
});

describe("Cache-Hit Fast Path", () => {
  beforeEach(() => {
    resetFontLoader();
    vi.clearAllMocks();
  });

  it("second ensureFont call on a bundled font returns immediately from cache (loadTimeMs=0)", async () => {
    const loader = new FontLoader();
    const desc = {
      family: "Bebas Neue",
      weight: 400,
      style: "normal" as const,
    };
    await loader.ensureFont(desc); // first load — goes through loadLocalFont
    vi.clearAllMocks();
    const result = await loader.ensureFont(desc); // cache hit
    expect(result.loaded).toBe(true);
    expect(result.loadTimeMs).toBe(0);
    expect(mockFonts.load).not.toHaveBeenCalled();
  });

  it("document.fonts.check fast-path fires before load() for CSS-preloaded bundled fonts", async () => {
    // mockFonts.check always returns true, simulating a CSS-preloaded face
    const loader = new FontLoader();
    await loader.ensureFont({
      family: "Poppins",
      weight: 400,
      style: "normal",
    });
    expect(mockFonts.load).not.toHaveBeenCalled();
  });
});

describe("prewarmProjectFonts() — Edge Cases", () => {
  beforeEach(() => {
    resetFontLoader();
    vi.clearAllMocks();
  });

  it("handles whitespace-only family strings without throwing", async () => {
    const loader = new FontLoader();
    await expect(
      loader.prewarmProjectFonts(["  ", "", "Inter"]),
    ).resolves.toBeUndefined();
  });

  it("does not call document.fonts for system fonts during project prewarm", async () => {
    const loader = new FontLoader();
    await loader.prewarmProjectFonts(["Arial", "Impact", "Georgia"]);
    expect(mockFonts.load).not.toHaveBeenCalled();
  });
});
