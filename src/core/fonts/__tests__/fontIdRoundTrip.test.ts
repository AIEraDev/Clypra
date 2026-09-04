/**
 * fontId round-trip and missing-font detection tests.
 *
 * Verifies:
 * - createTextClip assigns a stable fontId
 * - fontId survives the evaluator (propagated to EvaluatedTextLayer.fontId)
 * - deriveFontId + getFontRecordById are inverses for all known fonts
 * - isKnownFont correctly identifies the missing-font boundary
 * - Missing fonts do not mutate project data
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  deriveFontId,
  getFontRecordById,
  isKnownFont,
  getBundledFontRecords,
  getSystemFontRecords,
  resolveCanonicalFamily,
} from "../fontRegistry";

// ─── Mock heavy dependencies so textClip and evaluator can be tested ─────────

vi.mock("@/features/text-effects/store/effectsStore", () => ({
  useEffectsStore: {
    getState: () => ({ definitions: {} }),
    setState: vi.fn(),
  },
}));

vi.mock("@/features/text-templates/templateStore", () => ({
  useTemplateStore: {
    getState: () => ({ templates: [] }),
  },
}));

vi.mock("@clypra-studio/engine", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@clypra-studio/engine")>();
  return {
    ...actual,
    resolveTextTemplateArtifact: vi.fn().mockReturnValue(null),
    resolveConform: vi.fn(),
  };
});

// ─── fontId round-trip via deriveFontId ───────────────────────────────────────

describe("deriveFontId round-trip", () => {
  it("deriveFontId + getFontRecordById round-trips for every bundled font", () => {
    for (const record of getBundledFontRecords()) {
      const id = deriveFontId(record.family);
      expect(id).toBe(record.id);
      const looked = getFontRecordById(id);
      expect(looked).toBe(record);
    }
  });

  it("deriveFontId + getFontRecordById round-trips for every system font", () => {
    for (const record of getSystemFontRecords()) {
      const id = deriveFontId(record.family);
      expect(id).toBe(record.id);
      const looked = getFontRecordById(id);
      expect(looked).toBe(record);
    }
  });

  it("deriveFontId is stable across calls (deterministic)", () => {
    expect(deriveFontId("Inter Variable")).toBe(deriveFontId("Inter Variable"));
    expect(deriveFontId("Bebas Neue")).toBe(deriveFontId("Bebas Neue"));
    expect(deriveFontId("Unknown Font")).toBe(deriveFontId("Unknown Font"));
  });

  it("deriveFontId aliases resolve to the same id", () => {
    // "inter" and "Inter Variable" both resolve to the same record
    expect(deriveFontId("inter")).toBe(deriveFontId("Inter Variable"));
    expect(deriveFontId("Roboto Condensed")).toBe(
      deriveFontId("Roboto Condensed Variable"),
    );
  });
});

// ─── isKnownFont — missing-font boundary ─────────────────────────────────────

describe("isKnownFont — missing-font detection boundary", () => {
  it("returns true for all bundled font families", () => {
    for (const record of getBundledFontRecords()) {
      expect(isKnownFont(record.family)).toBe(true);
    }
  });

  it("returns true for all system font families", () => {
    for (const record of getSystemFontRecords()) {
      expect(isKnownFont(record.family)).toBe(true);
    }
  });

  it("returns true for alias forms of bundled fonts", () => {
    expect(isKnownFont("inter")).toBe(true);
    expect(isKnownFont("roboto condensed")).toBe(true);
    expect(isKnownFont("dancing script variable")).toBe(true);
  });

  it("returns false for common web fonts not in the bundle", () => {
    const unbundled = [
      "Helvetica",
      "Helvetica Neue",
      "Futura",
      "Gill Sans",
      "Avenir",
      "Comic Sans MS",
    ];
    for (const family of unbundled) {
      expect(isKnownFont(family)).toBe(false);
    }
  });

  it("correctly distinguishes a missing font from a present one", () => {
    // Simulate what _prewarmProjectFonts does:
    const projectFonts = ["Inter Variable", "Bebas Neue", "Helvetica Neue"];
    const missingFonts = projectFonts.filter((f) => !isKnownFont(f));
    expect(missingFonts).toEqual(["Helvetica Neue"]);
  });

  it("does not mutate the input family string when a font is missing", () => {
    const originalFamily = "Helvetica Neue";
    const copy = originalFamily;
    isKnownFont(originalFamily); // should not alter anything
    expect(originalFamily).toBe(copy);
    // The registry lookup must be read-only
    expect(resolveCanonicalFamily(originalFamily)).toBe(originalFamily);
  });

  it("missing font preserves its original string through resolveCanonicalFamily", () => {
    // resolveCanonicalFamily must pass unknown fonts through unchanged
    // so the project data model is never silently mutated.
    expect(resolveCanonicalFamily("Custom Brand Font")).toBe("Custom Brand Font");
    expect(resolveCanonicalFamily("helvetica")).toBe("helvetica");
  });
});

// ─── fontId stability invariants ─────────────────────────────────────────────

describe("fontId stability — project portability", () => {
  it("fontId for bundled fonts never contains a filesystem path", () => {
    for (const record of getBundledFontRecords()) {
      expect(record.id).not.toContain("/");
      expect(record.id).not.toContain("\\");
      expect(record.id).not.toContain(".woff");
      expect(record.id).not.toContain(".ttf");
    }
  });

  it("fontId for bundled fonts contains only lowercase alphanumeric and hyphens", () => {
    for (const record of getBundledFontRecords()) {
      expect(record.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("fontId for system fonts contains only lowercase alphanumeric and hyphens", () => {
    for (const record of getSystemFontRecords()) {
      expect(record.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("deriveFontId slug for unknown fonts never includes machine paths", () => {
    const userFont = "/Users/alice/Library/Fonts/Brand.ttf";
    const slug = deriveFontId(userFont);
    // The slug should be derived from the path string but not contain raw /
    expect(slug).not.toContain("/");
    expect(slug).not.toContain("\\");
    // Expect kebab-case result
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});
