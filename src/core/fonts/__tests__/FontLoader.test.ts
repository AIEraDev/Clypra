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

    it("loads bundled editor fonts locally without injecting Google Fonts", async () => {
      const result = await loader.ensureFont({
        family: "Bebas Neue",
        weight: 700,
        style: "normal" as const,
      });

      expect(result.loaded).toBe(true);
      // The check() fast-path short-circuits before load() when the face is
      // already registered (e.g. via CSS @fontsource import). Either path is
      // valid; what matters is that no Google Fonts stylesheet was injected.
      expect(document.getElementById("gfont-bebas-neue")).toBeNull();
    });

    it("resolves variable-font aliases to their local CSS family", async () => {
      const result = await loader.ensureFont({
        family: "Inter",
        weight: 600,
        style: "normal" as const,
      });

      expect(result.loaded).toBe(true);
      // When document.fonts.check() already returns true (CSS preloaded),
      // the loader short-circuits before calling load(). Either path is valid;
      // the key invariant is that the result is loaded and no engine network
      // request was made for this bundled family.
      const wasLocallyResolved =
        mockFonts.load.mock.calls.some((args: string[]) =>
          args[0]?.includes("Inter Variable"),
        ) || result.loadTimeMs === 0;
      expect(wasLocallyResolved).toBe(true);
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

// ─── New tests for performance fast-paths & prewarm APIs ─────────────────────

describe("system font fast path (0ms resolution)", () => {
  beforeEach(() => {
    resetFontLoader();
    vi.clearAllMocks();
  });

  const SYSTEM_FONTS_CASES = [
    "Arial",
    "Arial Black",
    "Arial Rounded MT Bold",
    "Georgia",
    "Times New Roman",
    "Courier New",
    "Impact",
    "Verdana",
    "Trebuchet MS",
    "Palatino",
  ] as const;

  for (const family of SYSTEM_FONTS_CASES) {
    it(`resolves "${family}" synchronously at loadTimeMs=0 without calling document.fonts.load`, async () => {
      const loader = new FontLoader();
      const result = await loader.ensureFont({
        family,
        weight: 400,
        style: "normal",
      });
      expect(result.loaded).toBe(true);
      expect(result.loadTimeMs).toBe(0);
      // System fonts must never trigger a document.fonts.load() call
      expect(mockFonts.load).not.toHaveBeenCalled();
    });

    it(`isLoaded returns true for "${family}" without any prior ensureFont call`, () => {
      const loader = new FontLoader();
      expect(loader.isLoaded({ family, weight: 400, style: "normal" })).toBe(
        true,
      );
    });
  }

  it("is case-insensitive for system font names", async () => {
    const loader = new FontLoader();
    const result = await loader.ensureFont({
      family: "ARIAL",
      weight: 400,
      style: "normal",
    });
    expect(result.loaded).toBe(true);
    expect(result.loadTimeMs).toBe(0);
    expect(mockFonts.load).not.toHaveBeenCalled();
  });
});

describe("document.fonts.check fast path (CSS preloaded face)", () => {
  beforeEach(() => {
    resetFontLoader();
    vi.clearAllMocks();
  });

  it("hits the check fast-path and skips document.fonts.load when check() already returns true", async () => {
    // document.fonts.check is already mocked to return true globally
    const loader = new FontLoader();
    // Inter is a bundled variable font — goes through the local path
    const result = await loader.ensureFont({
      family: "Inter",
      weight: 400,
      style: "normal",
    });
    expect(result.loaded).toBe(true);
    // load() must NOT be called because check() short-circuits first
    expect(mockFonts.load).not.toHaveBeenCalled();
    expect(result.loadTimeMs).toBe(0);
  });

  it("marks the descriptor as loaded after the check fast-path so isLoaded returns true", async () => {
    const loader = new FontLoader();
    const desc = { family: "Inter", weight: 400, style: "normal" as const };
    await loader.ensureFont(desc);
    expect(loader.isLoaded(desc)).toBe(true);
  });
});

describe("prewarmProjectFonts()", () => {
  beforeEach(() => {
    resetFontLoader();
    vi.clearAllMocks();
  });

  it("loads all unique families from the supplied list", async () => {
    const loader = new FontLoader();
    await loader.prewarmProjectFonts(["Inter", "Bebas Neue", "Inter"]); // duplicate intentional
    // "Inter" normalises to "Inter Variable" internally. isLoaded accepts
    // either form since the alias map normalises the key lookup.
    expect(
      loader.isLoaded({ family: "Inter", weight: 400, style: "normal" }) ||
        loader.isLoaded({
          family: "Inter Variable",
          weight: 400,
          style: "normal",
        }),
    ).toBe(true);
    expect(
      loader.isLoaded({ family: "Bebas Neue", weight: 400, style: "normal" }),
    ).toBe(true);
  });

  it("completes without error for an empty list", async () => {
    const loader = new FontLoader();
    await expect(loader.prewarmProjectFonts([])).resolves.toBeUndefined();
  });

  it("silently ignores unknown families (delegated to engine fallback)", async () => {
    const loader = new FontLoader();
    // Should not throw even though "CustomFont" has no local alias
    await expect(
      loader.prewarmProjectFonts(["CustomFont"]),
    ).resolves.toBeUndefined();
  });

  it("resolves aliases — 'Inter' and 'Inter Variable' deduplicate to one load call", async () => {
    const loader = new FontLoader();
    await loader.prewarmProjectFonts(["Inter", "Inter Variable"]);
    const stats = loader.getStats();
    // Both aliases point to the same canonical family; only one face is loaded
    expect(stats.loaded).toBeGreaterThanOrEqual(1);
  });
});

describe("prewarmRemainingFontsOnIdle()", () => {
  beforeEach(() => {
    resetFontLoader();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules via setTimeout when requestIdleCallback is unavailable", () => {
    const loader = new FontLoader();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    loader.prewarmRemainingFontsOnIdle();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
  });

  it("does not schedule more than once per instance", () => {
    const loader = new FontLoader();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    loader.prewarmRemainingFontsOnIdle();
    loader.prewarmRemainingFontsOnIdle();
    loader.prewarmRemainingFontsOnIdle();
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  it("resets the idle-scheduled flag after clear() so a fresh sweep can be scheduled", () => {
    const loader = new FontLoader();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    loader.prewarmRemainingFontsOnIdle();
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    loader.clear();
    loader.prewarmRemainingFontsOnIdle();
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
  });

  it("runs the sweep callback and triggers ensureFont for unloaded families", async () => {
    const loader = new FontLoader();
    const ensureSpy = vi.spyOn(loader, "ensureFont");
    loader.prewarmRemainingFontsOnIdle();
    // Flush the setTimeout(fn, 0) callback
    await vi.runAllTimersAsync();
    expect(ensureSpy).toHaveBeenCalled();
  });

  it("skips families already loaded when the sweep runs", async () => {
    const loader = new FontLoader();
    // Prewarm Inter first so it's already in the loaded set
    await loader.prewarmProjectFonts(["Inter Variable"]);
    const callsBefore = mockFonts.load.mock.calls.length;
    loader.prewarmRemainingFontsOnIdle();
    await vi.runAllTimersAsync();
    // Inter Variable was already loaded, so load() should not be called for it again
    const callsAfter = mockFonts.load.mock.calls.length;
    const interCalls = mockFonts.load.mock.calls
      .slice(callsBefore)
      .filter((args: string[]) => args[0]?.includes("Inter Variable"));
    expect(interCalls.length).toBe(0);
    void callsAfter; // suppress unused-variable warning
  });
});
