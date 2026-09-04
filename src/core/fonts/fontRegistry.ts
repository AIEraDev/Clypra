/**
 * Canonical Clypra Font Registry
 *
 * Single source of truth for all font metadata in the application.
 * Replaces the previously scattered data across:
 *   - FontLoader.ts  (LOCAL_FONT_FAMILY_ALIASES, SYSTEM_FONT_NAMES)
 *   - nativeFontRegistry.ts (BUNDLED_FONTS)
 *   - evaluator.ts (normalizeFontFamily if-chain)
 *   - TextStyleSection.tsx (SYSTEM_FONTS, GOOGLE_FONTS arrays)
 *
 * Architectural principles:
 * - One Map<aliasLower, canonicalFamily> for O(1) resolution everywhere.
 * - Each font record carries its source classification.
 * - System fonts resolve at 0ms (OS-resident, never fetched).
 * - Bundled fonts are delivered offline via @fontsource WOFF2 assets.
 * - No remote CDN or Google Fonts references exist in this registry.
 * - Adding a new font requires editing only this file + package.json + index.css.
 *
 * Font domain separation:
 * - "system"   → OS-resident; available in browser previews only (not native).
 * - "bundled"  → Shipped as WOFF2 inside the app bundle; available everywhere.
 * - "emoji"    → Internal native-only fallback; not shown in the UI picker.
 *
 * Future sources (not yet implemented):
 * - "user"     → User-managed fonts imported from disk.
 * - "project"  → Fonts embedded in a project package.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type FontSource = "system" | "bundled" | "emoji" | "user" | "project";
export type FontOrigin = "bundled" | "catalog" | "imported";
export type FontCategory =
  | "sans-serif"
  | "serif"
  | "monospace"
  | "display"
  | "script";
export type FontStatus = "available" | "loading" | "loaded" | "missing" | "failed";
export type FontStyle = "normal" | "italic";

/**
 * A logical font family in the Clypra registry.
 * Keyed by `id` — a stable lowercase-kebab identifier.
 */
export interface FontRecord {
  /** Stable lowercase-kebab font identifier, e.g. "inter-variable". */
  readonly id: string;
  /**
   * Canonical CSS family name exactly as registered in document.fonts /
   * the Rust FontRegistry, e.g. "Inter Variable".
   * This is the value stored in TextClip.fontFamily after normalization.
   */
  readonly family: string;
  /** Human-readable label shown in the font picker. */
  readonly displayName: string;
  /** Where this font comes from. */
  readonly source: FontSource;
  /** Origin domain classification for asset distribution and persistence. */
  readonly origin?: FontOrigin;
  /** Typographic classification used for contextual fallback resolution. */
  readonly category?: FontCategory;
  /**
   * All lowercase alias strings that resolve to this record.
   * Includes the canonical family lowercase and any legacy/short names.
   */
  readonly aliases: readonly string[];
  /**
   * Numeric weights supported by this font.
   * Variable fonts list [100,200,...,900]; static fonts list [400] or similar.
   */
  readonly weights: readonly number[];
  /** Styles supported (normal and/or italic). */
  readonly styles: readonly FontStyle[];
}

// ─── System fonts (OS-resident, browser preview only) ────────────────────────
//
// These are always available without any async load. They are excluded from
// the Tauri/native font picker because the Rust rasterizer has no WOFF2 for
// them and they are not registered in the native FontRegistry.

const SYSTEM_FONT_RECORDS: readonly FontRecord[] = [
  {
    id: "arial",
    family: "Arial",
    displayName: "Arial",
    source: "system",
    aliases: ["arial"],
    weights: [400, 700],
    styles: ["normal", "italic"],
  },
  {
    id: "arial-black",
    family: "Arial Black",
    displayName: "Arial Black",
    source: "system",
    aliases: ["arial black"],
    weights: [900],
    styles: ["normal"],
  },
  {
    id: "arial-rounded-mt-bold",
    family: "Arial Rounded MT Bold",
    displayName: "Arial Rounded MT Bold",
    source: "system",
    aliases: ["arial rounded mt bold"],
    weights: [700],
    styles: ["normal"],
  },
  {
    id: "georgia",
    family: "Georgia",
    displayName: "Georgia",
    source: "system",
    aliases: ["georgia"],
    weights: [400, 700],
    styles: ["normal", "italic"],
  },
  {
    id: "times-new-roman",
    family: "Times New Roman",
    displayName: "Times New Roman",
    source: "system",
    aliases: ["times new roman", "times"],
    weights: [400, 700],
    styles: ["normal", "italic"],
  },
  {
    id: "courier-new",
    family: "Courier New",
    displayName: "Courier New",
    source: "system",
    aliases: ["courier new", "courier"],
    weights: [400, 700],
    styles: ["normal", "italic"],
  },
  {
    id: "impact",
    family: "Impact",
    displayName: "Impact",
    source: "system",
    aliases: ["impact"],
    weights: [400],
    styles: ["normal"],
  },
  {
    id: "verdana",
    family: "Verdana",
    displayName: "Verdana",
    source: "system",
    aliases: ["verdana"],
    weights: [400, 700],
    styles: ["normal", "italic"],
  },
  {
    id: "trebuchet-ms",
    family: "Trebuchet MS",
    displayName: "Trebuchet MS",
    source: "system",
    aliases: ["trebuchet ms", "trebuchet"],
    weights: [400, 700],
    styles: ["normal", "italic"],
  },
  {
    id: "palatino",
    family: "Palatino",
    displayName: "Palatino",
    source: "system",
    aliases: ["palatino", "palatino linotype", "book antiqua"],
    weights: [400, 700],
    styles: ["normal", "italic"],
  },
];

// ─── Bundled fonts (offline WOFF2, available in both browser and native) ──────
//
// Listed in the same order as BUNDLED_FONTS in nativeFontRegistry.ts.
// Variable fonts support weights 100–900; static fonts list only 400.
// To add a font: add the record here + import in nativeFontRegistry.ts +
// @import in index.css + package.json dependency.

const BUNDLED_FONT_RECORDS: readonly FontRecord[] = [
  // ── Variable fonts ─────────────────────────────────────────────────────────
  {
    id: "inter-variable",
    family: "Inter Variable",
    displayName: "Inter",
    source: "bundled",
    aliases: ["inter variable", "inter"],
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ["normal"],
  },
  {
    id: "montserrat-variable",
    family: "Montserrat Variable",
    displayName: "Montserrat",
    source: "bundled",
    aliases: ["montserrat variable", "montserrat"],
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ["normal", "italic"],
  },
  {
    id: "geist-variable",
    family: "Geist Variable",
    displayName: "Geist",
    source: "bundled",
    aliases: ["geist variable", "geist"],
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ["normal"],
  },
  {
    id: "space-grotesk-variable",
    family: "Space Grotesk Variable",
    displayName: "Space Grotesk",
    source: "bundled",
    aliases: ["space grotesk variable", "space grotesk"],
    weights: [300, 400, 500, 600, 700],
    styles: ["normal"],
  },
  {
    id: "roboto-variable",
    family: "Roboto Variable",
    displayName: "Roboto",
    source: "bundled",
    aliases: ["roboto variable", "roboto"],
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ["normal", "italic"],
  },
  {
    id: "outfit-variable",
    family: "Outfit Variable",
    displayName: "Outfit",
    source: "bundled",
    aliases: ["outfit variable", "outfit"],
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ["normal"],
  },
  {
    id: "roboto-condensed-variable",
    family: "Roboto Condensed Variable",
    displayName: "Roboto Condensed",
    source: "bundled",
    //  Both "Roboto Condensed" and "Roboto Condensed Variable" are valid aliases.
    //  Previously normalizeFontFamily returned "Roboto Condensed" (wrong); the
    //  canonical CSS family registered by @fontsource-variable/roboto-condensed
    //  is "Roboto Condensed Variable". All alias lookups now resolve here.
    aliases: ["roboto condensed variable", "roboto condensed"],
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ["normal", "italic"],
  },
  {
    id: "open-sans-variable",
    family: "Open Sans Variable",
    displayName: "Open Sans",
    source: "bundled",
    aliases: ["open sans variable", "open sans"],
    weights: [300, 400, 500, 600, 700, 800],
    styles: ["normal", "italic"],
  },
  {
    id: "raleway-variable",
    family: "Raleway Variable",
    displayName: "Raleway",
    source: "bundled",
    aliases: ["raleway variable", "raleway"],
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ["normal", "italic"],
  },
  {
    id: "oswald-variable",
    family: "Oswald Variable",
    displayName: "Oswald",
    source: "bundled",
    aliases: ["oswald variable", "oswald"],
    weights: [200, 300, 400, 500, 600, 700],
    styles: ["normal"],
  },
  {
    id: "playfair-display-variable",
    family: "Playfair Display Variable",
    displayName: "Playfair Display",
    source: "bundled",
    aliases: ["playfair display variable", "playfair display"],
    weights: [400, 500, 600, 700, 800, 900],
    styles: ["normal", "italic"],
  },
  {
    id: "nunito-variable",
    family: "Nunito Variable",
    displayName: "Nunito",
    source: "bundled",
    aliases: ["nunito variable", "nunito"],
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    styles: ["normal", "italic"],
  },
  {
    id: "dancing-script-variable",
    family: "Dancing Script Variable",
    displayName: "Dancing Script",
    source: "bundled",
    aliases: ["dancing script variable", "dancing script"],
    weights: [400, 500, 600, 700],
    styles: ["normal"],
  },
  // ── Static fonts ───────────────────────────────────────────────────────────
  {
    id: "lato",
    family: "Lato",
    displayName: "Lato",
    source: "bundled",
    aliases: ["lato"],
    weights: [400],
    styles: ["normal"],
  },
  {
    id: "anton",
    family: "Anton",
    displayName: "Anton",
    source: "bundled",
    aliases: ["anton"],
    weights: [400],
    styles: ["normal"],
  },
  {
    id: "bebas-neue",
    family: "Bebas Neue",
    displayName: "Bebas Neue",
    source: "bundled",
    aliases: ["bebas neue"],
    weights: [400],
    styles: ["normal"],
  },
  {
    id: "poppins",
    family: "Poppins",
    displayName: "Poppins",
    source: "bundled",
    aliases: ["poppins"],
    weights: [400],
    styles: ["normal"],
  },
  {
    id: "permanent-marker",
    family: "Permanent Marker",
    displayName: "Permanent Marker",
    source: "bundled",
    aliases: ["permanent marker"],
    weights: [400],
    styles: ["normal"],
  },
  {
    id: "bangers",
    family: "Bangers",
    displayName: "Bangers",
    source: "bundled",
    aliases: ["bangers"],
    weights: [400],
    styles: ["normal"],
  },
  {
    id: "press-start-2p",
    family: "Press Start 2P",
    displayName: "Press Start 2P",
    source: "bundled",
    aliases: ["press start 2p"],
    weights: [400],
    styles: ["normal"],
  },
  {
    id: "pacifico",
    family: "Pacifico",
    displayName: "Pacifico",
    source: "bundled",
    aliases: ["pacifico"],
    weights: [400],
    styles: ["normal"],
  },
];

// ─── Internal emoji fallback (native only) ────────────────────────────────────

const EMOJI_FONT_RECORD: FontRecord = {
  id: "noto-emoji",
  family: "__clypra_noto_emoji",
  displayName: "Noto Emoji",
  source: "emoji",
  aliases: ["__clypra_noto_emoji", "noto emoji"],
  weights: [400],
  styles: ["normal"],
};

// ─── Master list ──────────────────────────────────────────────────────────────

/**
 * All font records known to Clypra.
 * Use the lookup maps below for performance-critical paths.
 */
export const ALL_FONT_RECORDS: readonly FontRecord[] = [
  ...SYSTEM_FONT_RECORDS,
  ...BUNDLED_FONT_RECORDS,
  EMOJI_FONT_RECORD,
];

// ─── Derived lookup maps (built once at module load, O(1) access) ─────────────

/**
 * Maps every known lowercase alias → canonical CSS family name.
 *
 * This is the single canonical alias map. FontLoader, evaluator, and all
 * other subsystems should source their normalization from this map rather
 * than maintaining their own.
 *
 * Example:
 *   "inter"             → "Inter Variable"
 *   "inter variable"    → "Inter Variable"
 *   "roboto condensed"  → "Roboto Condensed Variable"  ← fixed
 *   "arial"             → "Arial"
 */
export const FONT_ALIAS_MAP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const record of ALL_FONT_RECORDS) {
    for (const alias of record.aliases) {
      map.set(alias.toLowerCase(), record.family);
    }
  }
  return map;
})();

/**
 * Maps canonical CSS family name (lowercase) → FontRecord.
 * Use for record lookup once you have the canonical family.
 */
export const FONT_RECORD_BY_FAMILY: ReadonlyMap<string, FontRecord> = (() => {
  const map = new Map<string, FontRecord>();
  for (const record of ALL_FONT_RECORDS) {
    map.set(record.family.toLowerCase(), record);
  }
  return map;
})();

/**
 * Maps stable font id → FontRecord.
 */
export const FONT_RECORD_BY_ID: ReadonlyMap<string, FontRecord> = (() => {
  const map = new Map<string, FontRecord>();
  for (const record of ALL_FONT_RECORDS) {
    map.set(record.id, record);
  }
  return map;
})();

/**
 * Set of lowercase OS-resident family names for O(1) system-font check.
 * Sourced from SYSTEM_FONT_RECORDS — not a separate constant.
 */
export const SYSTEM_FONT_NAME_SET: ReadonlySet<string> = new Set(
  SYSTEM_FONT_RECORDS.flatMap((r) => r.aliases),
);

/**
 * Set of lowercase bundled family aliases for O(1) bundled-font check.
 */
export const BUNDLED_FONT_ALIAS_SET: ReadonlySet<string> = new Set(
  BUNDLED_FONT_RECORDS.flatMap((r) => r.aliases),
);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve any font family alias string to its canonical CSS family name.
 *
 * Returns the canonical name if found, or the original string if not.
 * This replaces the `normalizeFontFamily` if-chain in evaluator.ts.
 *
 * O(1) Map lookup.
 *
 * @example
 *   resolveCanonicalFamily("inter")             // "Inter Variable"
 *   resolveCanonicalFamily("Roboto Condensed")  // "Roboto Condensed Variable"
 *   resolveCanonicalFamily("Bebas Neue")        // "Bebas Neue"
 *   resolveCanonicalFamily("Unknown Font")      // "Unknown Font" (pass-through)
 */
export function resolveCanonicalFamily(family: string): string {
  if (!family) return family;
  const trimmed = family.trim();
  const direct = FONT_ALIAS_MAP.get(trimmed.toLowerCase());
  if (direct) return direct;

  // Handle CSS font stacks (e.g. "Inter, system-ui, sans-serif" or "'Inter Variable', sans-serif")
  const primary = trimmed.split(",")[0].trim().replace(/^["']|["']$/g, "");
  if (primary) {
    const primaryMatch = FONT_ALIAS_MAP.get(primary.toLowerCase());
    if (primaryMatch) return primaryMatch;
  }

  return trimmed;
}

/**
 * Look up the FontRecord for a given family alias.
 * Returns undefined for unknown/user/project fonts.
 */
export function getFontRecord(family: string): FontRecord | undefined {
  if (!family) return undefined;
  const canonical = resolveCanonicalFamily(family);
  return FONT_RECORD_BY_FAMILY.get(canonical.toLowerCase());
}

/**
 * Look up a FontRecord by its stable id.
 * Returns undefined if the id is not in the registry.
 */
export function getFontRecordById(id: string): FontRecord | undefined {
  return FONT_RECORD_BY_ID.get(id);
}

/**
 * Returns true if the family is an OS-resident system font that requires
 * no async loading on any platform.
 */
export function isSystemFont(family: string): boolean {
  return SYSTEM_FONT_NAME_SET.has(family.trim().toLowerCase());
}

/**
 * Returns true if the family resolves to a font bundled with the app.
 * Bundled fonts work offline and are registered with the native Rust rasterizer.
 */
export function isBundledFont(family: string): boolean {
  const canonical = resolveCanonicalFamily(family);
  return BUNDLED_FONT_ALIAS_SET.has(canonical.toLowerCase());
}

/**
 * Returns true if the family is known to the registry (system or bundled).
 * User/project fonts are NOT in the registry by default.
 */
export function isKnownFont(family: string): boolean {
  if (!family) return false;
  return FONT_ALIAS_MAP.has(family.trim().toLowerCase());
}

/**
 * Derive a stable font id from a family string.
 * For known fonts, returns the record's id. For unknown fonts,
 * produces a deterministic slug from the family name.
 *
 * Used when creating a new TextClip to assign a stable fontId.
 */
export function deriveFontId(family: string): string {
  const record = getFontRecord(family);
  if (record) return record.id;
  // Produce a stable slug for unknown fonts (user/project fonts)
  return family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * All bundled font records, in picker display order.
 * Excludes system and emoji fonts.
 */
export function getBundledFontRecords(): readonly FontRecord[] {
  return BUNDLED_FONT_RECORDS;
}

/**
 * All system font records.
 */
export function getSystemFontRecords(): readonly FontRecord[] {
  return SYSTEM_FONT_RECORDS;
}

/**
 * Resolve a font family or fontId to a FontRecord.
 * fontId takes priority over family string when both are provided.
 *
 * Returns undefined if neither resolves to a known record.
 */
export function resolveFont(
  fontFamily: string,
  fontId?: string,
): FontRecord | undefined {
  if (fontId) {
    const byId = getFontRecordById(fontId);
    if (byId) return byId;
  }
  return getFontRecord(fontFamily);
}

/**
 * Resolves a context-aware fallback font record when a requested font is missing.
 * Prevents visually jarring monospace substitution in video titles and subtitles.
 */
export function resolveContextualFallback(
  requestedFamilyOrId: string,
): FontRecord {
  const lower = requestedFamilyOrId.trim().toLowerCase();

  // 1. Serif fallback
  if (
    lower.includes("serif") ||
    lower.includes("playfair") ||
    lower.includes("times") ||
    lower.includes("georgia") ||
    lower.includes("palatino")
  ) {
    const serifRecord =
      FONT_RECORD_BY_ID.get("playfair-display-variable") ??
      FONT_RECORD_BY_ID.get("georgia");
    if (serifRecord) return serifRecord;
  }

  // 2. Monospace fallback
  if (
    lower.includes("mono") ||
    lower.includes("code") ||
    lower.includes("inconsolata") ||
    lower.includes("courier")
  ) {
    const monoRecord = FONT_RECORD_BY_ID.get("courier-new");
    if (monoRecord) return monoRecord;
  }

  // 3. Display / Condensed fallback
  if (
    lower.includes("condensed") ||
    lower.includes("bebas") ||
    lower.includes("anton") ||
    lower.includes("oswald") ||
    lower.includes("impact")
  ) {
    const displayRecord =
      FONT_RECORD_BY_ID.get("bebas-neue") ??
      FONT_RECORD_BY_ID.get("oswald-variable") ??
      FONT_RECORD_BY_ID.get("anton");
    if (displayRecord) return displayRecord;
  }

  // 4. Script / Handwriting fallback
  if (
    lower.includes("script") ||
    lower.includes("hand") ||
    lower.includes("pacifico") ||
    lower.includes("dancing")
  ) {
    const scriptRecord =
      FONT_RECORD_BY_ID.get("dancing-script-variable") ??
      FONT_RECORD_BY_ID.get("pacifico");
    if (scriptRecord) return scriptRecord;
  }

  // 5. Default proportional sans-serif cascade
  return (
    FONT_RECORD_BY_ID.get("inter-variable") ??
    FONT_RECORD_BY_ID.get("roboto-variable") ??
    BUNDLED_FONT_RECORDS[0]
  );
}
