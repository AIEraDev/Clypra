/**
 * Clypra Font System
 *
 * Single import point for all font-related utilities.
 *
 * Architecture:
 *   fontRegistry  — canonical font record data, alias map, resolution helpers
 *   FontLoader    — browser document.fonts loading, prewarm, offline guard
 *   nativeFontRegistry — Tauri/Rust WOFF2 registration and idle prewarm
 */

// ─── Canonical registry (metadata, resolution, types) ────────────────────────
export type {
  FontRecord,
  FontSource,
  FontStatus,
  FontStyle,
} from "./fontRegistry";
export {
  ALL_FONT_RECORDS,
  FONT_ALIAS_MAP,
  FONT_RECORD_BY_FAMILY,
  FONT_RECORD_BY_ID,
  SYSTEM_FONT_NAME_SET,
  BUNDLED_FONT_ALIAS_SET,
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
} from "./fontRegistry";

// ─── Browser font loader ──────────────────────────────────────────────────────
export type {
  FontDescriptor,
  FontLoadResult,
  FontLoaderOptions,
} from "./FontLoader";
export {
  FontLoader,
  getFontLoader,
  initFontLoader,
  resetFontLoader,
  ensureFontsLoaded,
} from "./FontLoader";
