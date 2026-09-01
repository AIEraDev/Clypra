/**
 * Application font loading boundary.
 *
 * Built-in editor fonts are shipped as local WOFF2 assets through index.css.
 * They must never go through the engine's Google Fonts fallback: injecting a
 * stylesheet while a preview is playing can block the main thread and cause
 * a text clip to miss its audio/video deadline.
 *
 * Unknown families are delegated to the engine for backwards compatibility
 * with user/template fonts that are not bundled with the application.
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
 */

import {
  FontLoader as EngineFontLoader,
  type FontDescriptor,
  type FontLoadResult,
} from "@clypra-studio/engine";

export type { FontDescriptor, FontLoadResult } from "@clypra-studio/engine";

/**
 * OS-resident fonts that are available on every platform without any network
 * or WOFF2 fetch. document.fonts.check() always returns true for these, so
 * ensureFont() short-circuits immediately with loadTimeMs = 0.
 */
const SYSTEM_FONT_NAMES = new Set<string>([
  "arial",
  "arial black",
  "arial rounded mt bold",
  "georgia",
  "times new roman",
  "courier new",
  "impact",
  "verdana",
  "trebuchet ms",
  "palatino",
]);

/**
 * @fontsource-variable registers these families with a ` Variable` suffix;
 * static @fontsource packages register the family without it. Keep aliases
 * here because project documents may use either form.
 */
const LOCAL_FONT_FAMILY_ALIASES = new Map<string, string>([
  ["inter", "Inter Variable"],
  ["inter variable", "Inter Variable"],
  ["montserrat", "Montserrat Variable"],
  ["montserrat variable", "Montserrat Variable"],
  ["geist", "Geist Variable"],
  ["geist variable", "Geist Variable"],
  ["space grotesk", "Space Grotesk Variable"],
  ["space grotesk variable", "Space Grotesk Variable"],
  ["roboto", "Roboto Variable"],
  ["roboto variable", "Roboto Variable"],
  ["outfit", "Outfit Variable"],
  ["outfit variable", "Outfit Variable"],
  ["roboto condensed", "Roboto Condensed Variable"],
  ["roboto condensed variable", "Roboto Condensed Variable"],
  ["open sans", "Open Sans Variable"],
  ["open sans variable", "Open Sans Variable"],
  ["raleway", "Raleway Variable"],
  ["raleway variable", "Raleway Variable"],
  ["oswald", "Oswald Variable"],
  ["oswald variable", "Oswald Variable"],
  ["playfair display", "Playfair Display Variable"],
  ["playfair display variable", "Playfair Display Variable"],
  ["nunito", "Nunito Variable"],
  ["nunito variable", "Nunito Variable"],
  ["dancing script", "Dancing Script Variable"],
  ["dancing script variable", "Dancing Script Variable"],
  ["lato", "Lato"],
  ["anton", "Anton"],
  ["bebas neue", "Bebas Neue"],
  ["poppins", "Poppins"],
  ["permanent marker", "Permanent Marker"],
  ["bangers", "Bangers"],
  ["press start 2p", "Press Start 2P"],
  ["pacifico", "Pacifico"],
]);

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
    {
      normal: 400,
      bold: 700,
      lighter: 300,
      bolder: 700,
    }[weight] ?? 400
  );
}

function descriptorKey(descriptor: FontDescriptor): string {
  return `${descriptor.family.trim().toLowerCase()}|${normalizeWeight(descriptor.weight)}|${descriptor.style || "normal"}`;
}

function getLocalFamily(family: string): string | undefined {
  return LOCAL_FONT_FAMILY_ALIASES.get(family.trim().toLowerCase());
}

function fontFaceString(descriptor: FontDescriptor, family: string): string {
  return `${descriptor.style || "normal"} ${normalizeWeight(descriptor.weight)} 16px "${family}"`;
}

class LocalFontLoader {
  private readonly fallback = new EngineFontLoader();
  private readonly loaded = new Set<string>();
  private readonly failed = new Map<string, string>();
  private readonly promises = new Map<string, Promise<FontLoadResult>>();
  /** Tracks whether an idle prewarm sweep has been scheduled. */
  private _idlePrewarmScheduled = false;

  async ensureFont(descriptor: FontDescriptor): Promise<FontLoadResult> {
    // ── Fast path 1: OS-resident system fonts ──────────────────────────────
    // These are always available; document.fonts.check() returns true without
    // any load() call. Resolve immediately at 0ms to avoid any async overhead.
    if (SYSTEM_FONT_NAMES.has(descriptor.family.trim().toLowerCase())) {
      const key = descriptorKey(descriptor);
      this.loaded.add(key);
      return { font: descriptor, loaded: true, loadTimeMs: 0 };
    }

    const localFamily = getLocalFamily(descriptor.family);
    if (!localFamily) return this.fallback.ensureFont(descriptor);

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
    if (SYSTEM_FONT_NAMES.has(descriptor.family.trim().toLowerCase()))
      return true;
    const localFamily = getLocalFamily(descriptor.family);
    return localFamily
      ? this.loaded.has(descriptorKey(descriptor))
      : this.fallback.isLoaded(descriptor);
  }

  getStats(): { loaded: number; loading: number; failed: number } {
    const fallbackStats = this.fallback.getStats();
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
    this.fallback.clear();
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
   * deferred-load path.
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
   * loads every entry from LOCAL_FONT_FAMILY_ALIASES that has not already been
   * loaded. This ensures fonts are warm before the user opens the font picker,
   * without competing with video playback or timeline operations.
   *
   * Calling this multiple times is safe — the sweep is scheduled at most once
   * per loader instance.
   */
  prewarmRemainingFontsOnIdle(): void {
    if (this._idlePrewarmScheduled) return;
    this._idlePrewarmScheduled = true;

    const run = () => {
      // Collect unique canonical families not yet loaded.
      const pending: string[] = [];
      const seen = new Set<string>();
      for (const canonical of LOCAL_FONT_FAMILY_ALIASES.values()) {
        if (!seen.has(canonical)) {
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
      // Fire-and-forget: failures are silently swallowed. The font picker will
      // still work; any unloaded font just pays the load cost on first use.
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

      // The @fontsource CSS imports above point at local WOFF2 assets. Calling
      // document.fonts.load here only waits for those assets; it does not make
      // a network request to Google Fonts.
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

let globalFontLoader: LocalFontLoader | null = null;

export { LocalFontLoader as FontLoader };

export function getFontLoader(): LocalFontLoader {
  if (!globalFontLoader) globalFontLoader = new LocalFontLoader();
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
