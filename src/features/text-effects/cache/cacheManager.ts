/**
 * Text Effects Cache Manager
 *
 * Centralized cache management for text effects across all layers:
 * - Memory cache (Zustand store)
 * - Persistent cache (IndexedDB)
 * - API cache (deprecated Map in TextEffectsApi)
 *
 * Use this manager for ALL cache operations to ensure consistency.
 */

import { getTextEffectCache } from "./persistentCache";
import { useEffectsStore } from "../store/effectsStore";

export class TextEffectsCacheManager {
  /**
   * Clear ALL text effect caches
   * - Zustand memory cache
   * - IndexedDB persistent cache
   * - Legacy API cache (if still present)
   * - Downloaded effects tracking
   */
  static async clearAll(): Promise<void> {
    console.log("[CacheManager] 🧹 Clearing all text effect caches...");

    // 1. Clear Zustand store memory cache
    useEffectsStore.setState({
      definitions: {},
      definitionRevisions: {},
      index: {},
      selectedEffect: null,
      selectedCategory: null,
    });
    console.log("[CacheManager] ✅ Cleared Zustand memory cache");

    // 2. Clear IndexedDB persistent cache
    const persistentCache = getTextEffectCache();
    await persistentCache.clear();
    console.log("[CacheManager] ✅ Cleared IndexedDB persistent cache");

    // 3. Clear legacy API cache (if imported)
    try {
      const { TextEffectsApi } = await import("../api/textEffectsApi");
      TextEffectsApi.clearLocalCache();
      console.log("[CacheManager] ✅ Cleared legacy API cache");
    } catch (e) {
      // API cache not available or already cleared
    }

    // 4. Clear downloaded effects tracking
    try {
      const { useFavoritesStore } = await import("@/store/favoritesStore");
      useFavoritesStore.getState().clearDownloadedEffects();
      console.log("[CacheManager] ✅ Cleared downloaded effects tracking");
    } catch (e) {
      console.warn("[CacheManager] Failed to clear downloaded effects tracking:", e);
    }

    console.log("[CacheManager] ✅ All caches cleared successfully");
  }

  /**
   * Clear cache for a specific effect
   */
  static async clearEffect(effectId: string): Promise<void> {
    console.log(`[CacheManager] 🧹 Clearing cache for effect: ${effectId}`);

    // 1. Remove from Zustand store
    useEffectsStore.setState((state) => {
      const newDefinitions = { ...state.definitions };
      delete newDefinitions[effectId];
      const definitionRevisions = { ...state.definitionRevisions };
      delete definitionRevisions[effectId];
      return { definitions: newDefinitions, definitionRevisions };
    });

    // 2. Remove from IndexedDB
    const persistentCache = getTextEffectCache();
    await persistentCache.delete(effectId);

    console.log(`[CacheManager] ✅ Cleared cache for effect: ${effectId}`);
  }

  /**
   * Get cache statistics across all layers
   */
  static async getStats(): Promise<{
    zustand: { count: number };
    indexedDB: { count: number; sizeMB: number };
    total: { effects: number; sizeMB: number };
  }> {
    // Zustand cache stats
    const zustandDefinitions = useEffectsStore.getState().definitions;
    const zustandCount = Object.keys(zustandDefinitions).length;

    // IndexedDB cache stats
    const persistentCache = getTextEffectCache();
    const persistentStats = await persistentCache.getStats();

    return {
      zustand: {
        count: zustandCount,
      },
      indexedDB: {
        count: persistentStats.diskCount,
        sizeMB: persistentStats.totalSizeMB,
      },
      total: {
        effects: Math.max(zustandCount, persistentStats.diskCount),
        sizeMB: persistentStats.totalSizeMB,
      },
    };
  }

  /**
   * Preload all cached effects into memory for faster access
   */
  static async preloadAll(): Promise<number> {
    console.log("[CacheManager] 🚀 Preloading all cached effects into memory...");

    const persistentCache = getTextEffectCache();
    const loaded = await persistentCache.preloadToMemory();

    console.log(`[CacheManager] ✅ Preloaded ${loaded} effects into memory`);
    return loaded;
  }

  /**
   * Verify cache integrity (check for corrupted entries)
   */
  static async verify(): Promise<{ valid: number; invalid: number; issues: string[] }> {
    console.log("[CacheManager] 🔍 Verifying cache integrity...");

    const issues: string[] = [];
    let valid = 0;
    let invalid = 0;

    const definitions = useEffectsStore.getState().definitions;

    for (const [id, definition] of Object.entries(definitions)) {
      try {
        // Basic validation
        if (!definition.id || !definition.name || !definition.category) {
          issues.push(`Invalid definition structure for: ${id}`);
          invalid++;
        } else if (definition.id !== id) {
          issues.push(`ID mismatch: key=${id}, definition.id=${definition.id}`);
          invalid++;
        } else {
          valid++;
        }
      } catch (e) {
        issues.push(`Error validating ${id}: ${e}`);
        invalid++;
      }
    }

    console.log(`[CacheManager] ✅ Verification complete: ${valid} valid, ${invalid} invalid`);
    if (issues.length > 0) {
      console.warn("[CacheManager] ⚠️ Issues found:", issues);
    }

    return { valid, invalid, issues };
  }
}

// Expose globally for debugging in console
if (typeof window !== "undefined") {
  (window as any).TextEffectsCacheManager = TextEffectsCacheManager;
}
