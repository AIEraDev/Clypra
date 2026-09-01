/**
 * Application font loading boundary.
 *
 * Built-in editor fonts are shipped as local WOFF2 assets through index.css.
 * They must never go through the engine's Google Fonts fallback: injecting a
 * stylesheet while a preview is playing can block the main thread and cause
 * a text clip to miss its audio/video deadline.
 *
 * Font metadata (alias table, system font set) is sourced exclusively from
 * fontRegistry.ts — the single canonical registry. Do not duplicate alias
 * tables here.
 *
 * Performance SLA:
 * - System fonts (OS-resident): resolved synchronously at 0ms — no
 *   document.fonts.load() call needed; the browser already has the face.
 * - Bundled WOFF2 fonts: first load goes through document.fonts.load(); all
 *   subsequent calls on the same descriptor return instantly from cache.
 * - prewarmProjectFonts(): loads only the font families currently used in the
 *   open project so the first rasterized frame pays zero font-wait cost.
 * - prewarmRemainingFontsOnIdle(): loads the remaining bundled fonts during
 *   requestIdleCallback / setTimeout(0) so they are warm before the user
 *   opens the font picker, without competing with video/audio playback.
 *
 * Offline guard:
 * - When constructed with `offlineOnly: true` (used on Tauri), the loader
 *   will not delegate unknown families to the EngineFontLoader CDN path.
 *   Unknown families return a failed result immediately, and a console warning
 *   is emitted so the caller knows the font is not available offline.
 */

import {
  FontLoader as EngineFontLoader,
  type FontDescriptor,
  type FontLoadResult,
} from "@clypra-studio/engine";
import {
  SYSTEM_FONT_NAME_SET,
  FONT_ALIAS_MAP,
  BUNDLED_FONT_ALIAS_SET,
} from "./fontRegistry";

export type { FontDescriptor, FontLoadResult } from "@clypra-studio/engine";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function normalizeWeight(weight: FontDescriptor["weight"]): number {
  if (typeof weight === "number") return weight;
  if (!weight) return 400;
  const numericWeight = Number.parseInt(weight, 10);
  if (
    !Number.isNaN(numericWeight) &&
    numericWeight >= 100 &&
    numericWeight <= 900
  ) {
    return numericWeight;
  }
  return (
    (
      {
        normal: 400,
        bold: 700,
        lighter: 300,
        bolder: 700,
      } as Record<string, number>
    )[weight] ?? 400
  );
}

function descriptorKey(descriptor: FontDescriptor): string {
  return `${descriptor.family.trim().toLowerCase()}|${normalizeWeight(descriptor.weight)}|${descriptor.style || "normal"}`;
}

/**
 * Resolve a raw family string to the canonical Fontsource CSS family name
 * using the registry's alias map.
 * Returns undefined if the family is not in the bundled/system registry.
 */
function getLocalFamily(family: string): string | undefined {
  return FONT_ALIAS_MAP.get(family.trim().toLowerCase());
}

function fontFaceString(descriptor: FontDescriptor, family: string): string {
  return `${descriptor.style || "normal"} ${normalizeWeight(descriptor.weight)} 16px "${family}"`;
}

// ─── LocalFontLoader ──────────────────────────────────────────────────────────

export interface FontLoaderOptions {
  /**
   * When true, the loader will NOT delegate unknown families to the
   * EngineFontLoader CDN path. Instead it returns a failed result and emits
   * a console warning. Set to true on Tauri where network CDN access is not
   * guaranteed and all fonts must be bundled.
   *
   * Default: false (browser mode — legacy CDN fallback allowed).
   */
  offlineOnly?: boolean;
}

class LocalFontLoader {
  private readonly fallback: EngineFontLoader | null;
  private readonly offlineOnly: boolean;
  private readonly loaded = new Set<string>();
  private readonly failed = new Map<string, string>();
  private readonly promises = new Map<string, Promise<FontLoadResult>>();
  /** Tracks whether an idle prewarm sweep has been scheduled. */
  private _idlePrewarmScheduled = false;

  constructor(options: FontLoaderOptions = {}) {
    this.offlineOnly = options.offlineOnly ?? false;
    // Only instantiate EngineFontLoader when CDN fallback is permitted.
    this.fallback = this.offlineOnly ? null : new EngineFontLoader();
  }

  async ensureFont(descriptor: FontDescriptor): Promise<FontLoadResult> {
    // ── Fast path 1: OS-resident system fonts ──────────────────────────────
    // Sourced from SYSTEM_FONT_NAME_SET in fontRegistry — no duplicate table.
    if (SYSTEM_FONT_NAME_SET.has(descriptor.family.trim().toLowerCase())) {
      const key = descriptorKey(descriptor);
      this.loaded.add(key);
      return { font: descriptor, loaded: true, loadTimeMs: 0 };
    }

    const localFamily = getLocalFamily(descriptor.family);

    // Unknown family: delegate to CDN or block depending on offlineOnly mode.
    if (!localFamily) {
      if (this.offlineOnly) {
        // Offline guard: reject unknown fonts without any network attempt.
        const msg = `[FontLoader] Font "${descriptor.family}" is not bundled and offline-only mode is active. Using fallback.`;
        console.warn(msg);
        return { font: descriptor, loaded: false, error: msg, loadTimeMs: 0 };
      }
      // Browser mode: delegate to engine's existing CDN path.
      return this.fallback!.ensureFont(descriptor);
    }

    const key = descriptorKey(descriptor);

    // ── Fast path 2: already loaded (internal cache hit) ──────────────────
    if (this.loaded.has(key)) {
      return { font: descriptor, loaded: true, loadTimeMs: 0 };
    }

    // ── Fast path 3: document.fonts already has the face (e.g. CSS preload) ─
    if (
      typeof document !== "undefined" &&
      document.fonts?.check(fontFaceString(descriptor, localFamily))
    ) {
      this.loaded.add(key);
      return { font: descriptor, loaded: true, loadTimeMs: 0 };
    }

    const failed = this.failed.get(key);
    if (failed) {
      return { font: descriptor, loaded: false, error: failed, loadTimeMs: 0 };
    }

    const pending = this.promises.get(key);
    if (pending) return pending;

    const startedAt = now();
    const loadPromise = this.loadLocalFont(descriptor, localFamily, startedAt);
    this.promises.set(key, loadPromise);
    return loadPromise;
  }

  async ensureFonts(descriptors: FontDescriptor[]): Promise<FontLoadResult[]> {
    return Promise.all(
      descriptors.map((descriptor) => this.ensureFont(descriptor)),
    );
  }

  async waitForFontsReady(): Promise<void> {
    if (typeof document === "undefined" || !document.fonts) return;
    await document.fonts.ready;
  }

  isLoaded(descriptor: FontDescriptor): boolean {
    // System fonts are always considered loaded — no async work needed.
    if (SYSTEM_FONT_NAME_SET.has(descriptor.family.trim().toLowerCase()))
      return true;
    const localFamily = getLocalFamily(descriptor.family);
    if (localFamily) return this.loaded.has(descriptorKey(descriptor));
    // Offline mode: unknown fonts are never loaded.
    if (this.offlineOnly) return false;
    return this.fallback?.isLoaded(descriptor) ?? false;
  }

  /**
   * Returns true if the family is a known bundled font (i.e. will not go to
   * the CDN path). Useful for missing-font detection.
   */
  isBundledFamily(family: string): boolean {
    const lower = family.trim().toLowerCase();
    return SYSTEM_FONT_NAME_SET.has(lower) || BUNDLED_FONT_ALIAS_SET.has(lower);
  }

  getStats(): { loaded: number; loading: number; failed: number } {
    const fallbackStats = this.fallback?.getStats() ?? {
      loaded: 0,
      loading: 0,
      failed: 0,
    };
    return {
      loaded: this.loaded.size + fallbackStats.loaded,
      loading: this.promises.size + fallbackStats.loading,
      failed: this.failed.size + fallbackStats.failed,
    };
  }

  clear(): void {
    this.loaded.clear();
    this.failed.clear();
    this.promises.clear();
    this._idlePrewarmScheduled = false;
    this.fallback?.clear();
  }

  /**
   * Project-scoped eager prewarm.
   *
   * Loads only the font families currently referenced by the open project
   * (extracted from text clips) into document.fonts in parallel. Call this
   * at project/session startup so every subsequent rasterizeTextLayerForNative
   * call hits the fast-path cache and pays 0ms font-wait cost.
   *
   * Families already loaded are skipped instantly. Unknown families (custom /
   * Google Fonts) are silently ignored — they follow the engine's existing
   * deferred-load path (or the offline-guard path on Tauri).
   */
  async prewarmProjectFonts(fontFamilies: readonly string[]): Promise<void> {
    const unique = [
      ...new Set(fontFamilies.map((f) => f.trim()).filter(Boolean)),
    ];
    if (unique.length === 0) return;
    // Use weight 400 / normal as a representative face. The actual clip weight
    // is resolved on first rasterize; this ensures the font bytes are decoded
    // and the family is warm in document.fonts before the first paint.
    await Promise.allSettled(
      unique.map((family) =>
        this.ensureFont({ family, weight: 400, style: "normal" }),
      ),
    );
  }

  /**
   * Low-priority background prewarm for all remaining bundled fonts.
   *
   * Schedules one requestIdleCallback (or setTimeout fallback) sweep that
   * loads every bundled font not already in the loaded cache. Ensures fonts
   * are warm before the user opens the font picker, without competing with
   * video playback or timeline operations.
   *
   * Calling this multiple times is safe — the sweep is scheduled at most once
   * per loader instance.
   */
  prewarmRemainingFontsOnIdle(): void {
    if (this._idlePrewarmScheduled) return;
    this._idlePrewarmScheduled = true;

    const run = () => {
      // Collect unique canonical bundled families not yet loaded.
      const pending: string[] = [];
      const seen = new Set<string>();
      // Iterate the alias map and collect canonical families for bundled fonts.
      for (const [alias, canonical] of FONT_ALIAS_MAP) {
        if (!seen.has(canonical) && BUNDLED_FONT_ALIAS_SET.has(alias)) {
          seen.add(canonical);
          const key = descriptorKey({
            family: canonical,
            weight: 400,
            style: "normal",
          });
          if (!this.loaded.has(key)) pending.push(canonical);
        }
      }
      if (pending.length === 0) return;
      void Promise.allSettled(
        pending.map((family) =>
          this.ensureFont({ family, weight: 400, style: "normal" }),
        ),
      );
    };

    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => run(), { timeout: 3000 });
    } else {
      setTimeout(run, 0);
    }
  }

  private async loadLocalFont(
    descriptor: FontDescriptor,
    localFamily: string,
    startedAt: number,
  ): Promise<FontLoadResult> {
    const key = descriptorKey(descriptor);
    const loadTimeMs = () => now() - startedAt;

    try {
      if (typeof document === "undefined" || !document.fonts) {
        throw new Error("Font API not available");
      }

      const requestedFace = fontFaceString(descriptor, localFamily);
      await document.fonts.load(requestedFace);

      if (!document.fonts.check(requestedFace)) {
        // Static packages intentionally ship one 400 face. Accept it for a
        // requested synthetic weight, matching the engine's existing policy.
        const fallbackFace = fontFaceString(
          { ...descriptor, weight: 400 },
          localFamily,
        );
        if (normalizeWeight(descriptor.weight) !== 400) {
          await document.fonts.load(fallbackFace);
        }
        if (!document.fonts.check(fallbackFace)) {
          throw new Error(`Bundled font "${descriptor.family}" failed to load`);
        }
      }

      this.loaded.add(key);
      return { font: descriptor, loaded: true, loadTimeMs: loadTimeMs() };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.failed.set(key, errorMessage);
      return {
        font: descriptor,
        loaded: false,
        error: errorMessage,
        loadTimeMs: loadTimeMs(),
      };
    } finally {
      this.promises.delete(key);
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let globalFontLoader: LocalFontLoader | null = null;

export { LocalFontLoader as FontLoader };

export function getFontLoader(): LocalFontLoader {
  if (!globalFontLoader) globalFontLoader = new LocalFontLoader();
  return globalFontLoader;
}

/**
 * Create (or recreate) the global font loader with explicit options.
 *
 * Call once at app startup:
 *   - Tauri: `initFontLoader({ offlineOnly: true })`
 *   - Browser: `initFontLoader()` or don't call (lazy default is fine)
 *
 * Must be called before any `getFontLoader()` usage to take effect.
 */
export function initFontLoader(
  options: FontLoaderOptions = {},
): LocalFontLoader {
  globalFontLoader = new LocalFontLoader(options);
  return globalFontLoader;
}

export function resetFontLoader(): void {
  globalFontLoader = null;
}

export async function ensureFontsLoaded(
  descriptors: FontDescriptor[],
): Promise<FontLoadResult[]> {
  return getFontLoader().ensureFonts(descriptors);
}
