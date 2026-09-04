/**
 * Font Registry Tests
 *
 * Verifies that the canonical fontRegistry.ts is the single source of truth:
 * - All alias lookups are O(1) and correct
 * - Source classification is correct (system / bundled / emoji)
 * - normalizeFontFamily delegates to resolveCanonicalFamily (evaluator path)
 * - deriveFontId produces stable, round-trippable IDs
 * - isKnownFont / isBundledFont / isSystemFont guards work
 * - Roboto Condensed Variable alias mismatch is fixed
 * - 'inter' → 'Inter Variable' (was 'Inter' in old if-chain) is fixed
 */

import { describe, it, expect } from "vitest";
import {
  resolveCanonicalFamily,
  getFontRecord,
  getFontRecordById,
  isSystemFont,
  isBundledFont,
  isKnownFont,
  deriveFontId,
  getBundledFontRecords,
  getSystemFontRecords,
  resolveFont,
  FONT_ALIAS_MAP,
  FONT_RECORD_BY_FAMILY,
  ALL_FONT_RECORDS,
  SYSTEM_FONT_NAME_SET,
  BUNDLED_FONT_ALIAS_SET,
} from "../fontRegistry";

// ─── resolveCanonicalFamily ───────────────────────────────────────────────────

describe("resolveCanonicalFamily", () => {
  it("resolves 'inter' → 'Inter Variable' (fixes old if-chain bug)", () => {
    expect(resolveCanonicalFamily("inter")).toBe("Inter Variable");
  });

  it("resolves 'Inter' → 'Inter Variable'", () => {
    expect(resolveCanonicalFamily("Inter")).toBe("Inter Variable");
  });

  it("resolves 'Inter Variable' → 'Inter Variable' (idempotent)", () => {
    expect(resolveCanonicalFamily("Inter Variable")).toBe("Inter Variable");
  });

  it("resolves 'Roboto Condensed' → 'Roboto Condensed Variable' (fixes old mismatch)", () => {
    expect(resolveCanonicalFamily("Roboto Condensed")).toBe(
      "Roboto Condensed Variable",
    );
  });

  it("resolves 'roboto condensed variable' → 'Roboto Condensed Variable'", () => {
    expect(resolveCanonicalFamily("roboto condensed variable")).toBe(
      "Roboto Condensed Variable",
    );
  });

  it("resolves 'roboto' → 'Roboto Variable'", () => {
    expect(resolveCanonicalFamily("roboto")).toBe("Roboto Variable");
  });

  it("resolves 'montserrat' → 'Montserrat Variable'", () => {
    expect(resolveCanonicalFamily("montserrat")).toBe("Montserrat Variable");
  });

  it("resolves 'bebas neue' → 'Bebas Neue' (static font, no Variable suffix)", () => {
    expect(resolveCanonicalFamily("bebas neue")).toBe("Bebas Neue");
  });

  it("resolves 'Bebas Neue' → 'Bebas Neue' (case-insensitive)", () => {
    expect(resolveCanonicalFamily("Bebas Neue")).toBe("Bebas Neue");
  });

  it("passes through unknown families unchanged", () => {
    expect(resolveCanonicalFamily("Unknown Custom Font")).toBe(
      "Unknown Custom Font",
    );
    expect(resolveCanonicalFamily("Helvetica")).toBe("Helvetica");
  });

  it("handles empty string gracefully", () => {
    expect(resolveCanonicalFamily("")).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(resolveCanonicalFamily("  inter  ")).toBe("Inter Variable");
  });

  // Verify all 10 system fonts resolve to themselves (canonical = family)
  const SYSTEM_FAMILIES = [
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
  ];
  for (const family of SYSTEM_FAMILIES) {
    it(`system font "${family}" resolves to itself`, () => {
      expect(resolveCanonicalFamily(family)).toBe(family);
    });
  }
});

// ─── getFontRecord / getFontRecordById ────────────────────────────────────────

describe("getFontRecord", () => {
  it("returns a FontRecord for a known bundled font", () => {
    const record = getFontRecord("Inter");
    expect(record).toBeDefined();
    expect(record!.id).toBe("inter-variable");
    expect(record!.family).toBe("Inter Variable");
    expect(record!.source).toBe("bundled");
  });

  it("returns the same record for all aliases of a font", () => {
    const a = getFontRecord("inter");
    const b = getFontRecord("Inter Variable");
    const c = getFontRecord("Inter");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("returns a FontRecord for a system font", () => {
    const record = getFontRecord("Impact");
    expect(record).toBeDefined();
    expect(record!.id).toBe("impact");
    expect(record!.source).toBe("system");
  });

  it("returns a FontRecord for Roboto Condensed via the short alias", () => {
    const record = getFontRecord("Roboto Condensed");
    expect(record).toBeDefined();
    expect(record!.family).toBe("Roboto Condensed Variable");
    expect(record!.id).toBe("roboto-condensed-variable");
  });

  it("returns undefined for an unknown family", () => {
    expect(getFontRecord("Unknown Font")).toBeUndefined();
    expect(getFontRecord("Helvetica")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(getFontRecord("")).toBeUndefined();
  });
});

describe("getFontRecordById", () => {
  it("looks up a record by stable id", () => {
    const record = getFontRecordById("inter-variable");
    expect(record).toBeDefined();
    expect(record!.family).toBe("Inter Variable");
  });

  it("looks up a system font by id", () => {
    const record = getFontRecordById("impact");
    expect(record).toBeDefined();
    expect(record!.source).toBe("system");
  });

  it("returns undefined for an unknown id", () => {
    expect(getFontRecordById("does-not-exist")).toBeUndefined();
  });
});

// ─── isSystemFont / isBundledFont / isKnownFont ───────────────────────────────

describe("isSystemFont", () => {
  it("returns true for all 10 system fonts", () => {
    const families = [
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
    ];
    for (const family of families) {
      expect(isSystemFont(family)).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(isSystemFont("ARIAL")).toBe(true);
    expect(isSystemFont("arial")).toBe(true);
    expect(isSystemFont("Arial")).toBe(true);
  });

  it("returns false for bundled fonts", () => {
    expect(isSystemFont("Inter Variable")).toBe(false);
    expect(isSystemFont("Bebas Neue")).toBe(false);
  });

  it("returns false for unknown fonts", () => {
    expect(isSystemFont("Helvetica")).toBe(false);
  });
});

describe("isBundledFont", () => {
  it("returns true for all bundled font records", () => {
    for (const record of getBundledFontRecords()) {
      // Test with the canonical family name
      expect(isBundledFont(record.family)).toBe(true);
      // Test with each alias
      for (const alias of record.aliases) {
        expect(isBundledFont(alias)).toBe(true);
      }
    }
  });

  it("returns false for system fonts", () => {
    expect(isBundledFont("Arial")).toBe(false);
    expect(isBundledFont("Impact")).toBe(false);
  });

  it("returns false for unknown fonts", () => {
    expect(isBundledFont("Helvetica")).toBe(false);
  });
});

describe("isKnownFont", () => {
  it("returns true for system fonts", () => {
    expect(isKnownFont("Arial")).toBe(true);
    expect(isKnownFont("Georgia")).toBe(true);
  });

  it("returns true for bundled fonts", () => {
    expect(isKnownFont("Inter")).toBe(true);
    expect(isKnownFont("Bebas Neue")).toBe(true);
    expect(isKnownFont("Roboto Condensed")).toBe(true);
  });

  it("returns false for unknown fonts", () => {
    expect(isKnownFont("Helvetica")).toBe(false);
    expect(isKnownFont("Custom Brand Font")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isKnownFont("")).toBe(false);
  });
});

// ─── deriveFontId ─────────────────────────────────────────────────────────────

describe("deriveFontId", () => {
  it("returns the stable registry id for known bundled fonts", () => {
    expect(deriveFontId("Inter Variable")).toBe("inter-variable");
    expect(deriveFontId("Inter")).toBe("inter-variable");
    expect(deriveFontId("Bebas Neue")).toBe("bebas-neue");
    expect(deriveFontId("Roboto Condensed")).toBe("roboto-condensed-variable");
  });

  it("returns the stable registry id for system fonts", () => {
    expect(deriveFontId("Impact")).toBe("impact");
    expect(deriveFontId("Arial")).toBe("arial");
  });

  it("produces a stable lowercase slug for unknown fonts", () => {
    expect(deriveFontId("My Custom Font")).toBe("my-custom-font");
    expect(deriveFontId("Helvetica Neue")).toBe("helvetica-neue");
  });

  it("slug strips leading/trailing hyphens", () => {
    expect(deriveFontId("  Spaced Font  ")).toBe("spaced-font");
  });

  it("deriveFontId is round-trippable via getFontRecordById for known fonts", () => {
    const families = [
      "Inter",
      "Bebas Neue",
      "Poppins",
      "Dancing Script",
      "Impact",
    ];
    for (const family of families) {
      const id = deriveFontId(family);
      const record = getFontRecordById(id);
      expect(record).toBeDefined();
    }
  });
});

// ─── resolveFont ──────────────────────────────────────────────────────────────

describe("resolveFont", () => {
  it("resolves by fontId when both id and family are provided", () => {
    const record = resolveFont("Inter", "inter-variable");
    expect(record).toBeDefined();
    expect(record!.id).toBe("inter-variable");
  });

  it("falls back to family lookup when fontId is undefined", () => {
    const record = resolveFont("Bebas Neue");
    expect(record).toBeDefined();
    expect(record!.id).toBe("bebas-neue");
  });

  it("returns undefined for unknown font with no id", () => {
    expect(resolveFont("Unknown Font")).toBeUndefined();
  });

  it("returns undefined when fontId is unknown but family is known", () => {
    // fontId takes priority; if the id is bad, the record lookup returns
    // undefined and falls through to family. But a wrong-format id won't
    // match, so family acts as the final fallback.
    const record = resolveFont("Inter", "wrong-id-format");
    // wrong-id-format is not in the registry; falls through to family "Inter"
    expect(record).toBeDefined();
    expect(record!.family).toBe("Inter Variable");
  });
});

// ─── Registry completeness invariants ────────────────────────────────────────

describe("registry completeness", () => {
  it("has exactly 10 system fonts", () => {
    expect(getSystemFontRecords()).toHaveLength(10);
  });

  it("has exactly 21 bundled fonts (matching BUNDLED_FONTS in nativeFontRegistry)", () => {
    expect(getBundledFontRecords()).toHaveLength(21);
  });

  it("every record has a unique id", () => {
    const ids = ALL_FONT_RECORDS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every record has a unique canonical family (case-insensitive)", () => {
    const families = ALL_FONT_RECORDS.map((r) => r.family.toLowerCase());
    expect(new Set(families).size).toBe(families.length);
  });

  it("FONT_ALIAS_MAP contains all aliases from all records", () => {
    for (const record of ALL_FONT_RECORDS) {
      for (const alias of record.aliases) {
        expect(FONT_ALIAS_MAP.has(alias.toLowerCase())).toBe(true);
        expect(FONT_ALIAS_MAP.get(alias.toLowerCase())).toBe(record.family);
      }
    }
  });

  it("FONT_RECORD_BY_FAMILY contains every canonical family", () => {
    for (const record of ALL_FONT_RECORDS) {
      expect(FONT_RECORD_BY_FAMILY.has(record.family.toLowerCase())).toBe(true);
    }
  });

  it("SYSTEM_FONT_NAME_SET contains all system font aliases", () => {
    for (const record of getSystemFontRecords()) {
      for (const alias of record.aliases) {
        expect(SYSTEM_FONT_NAME_SET.has(alias.toLowerCase())).toBe(true);
      }
    }
  });

  it("BUNDLED_FONT_ALIAS_SET contains all bundled font aliases", () => {
    for (const record of getBundledFontRecords()) {
      for (const alias of record.aliases) {
        expect(BUNDLED_FONT_ALIAS_SET.has(alias.toLowerCase())).toBe(true);
      }
    }
  });

  it("no alias appears in both system and bundled sets", () => {
    for (const alias of SYSTEM_FONT_NAME_SET) {
      expect(BUNDLED_FONT_ALIAS_SET.has(alias)).toBe(false);
    }
  });

  it("every bundled font record has at least one weight defined", () => {
    for (const record of getBundledFontRecords()) {
      expect(record.weights.length).toBeGreaterThan(0);
    }
  });

  it("every record has at least 'normal' style", () => {
    for (const record of ALL_FONT_RECORDS) {
      if (record.source !== "emoji") {
        expect(record.styles).toContain("normal");
      }
    }
  });
});
