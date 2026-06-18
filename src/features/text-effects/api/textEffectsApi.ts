import { TextEffectDefinition } from "../types/types";
import { TemplateDefinition } from "@/features/text-templates/types";
import { getApiHeaders, getApiBaseUrl } from "@/lib/api";
import { convertRawConfigToDefinition } from "../lib/definitionConversion";

export interface TextEffectSummary {
  id: string;
  name: string;
  category: string;
  tags: string[];
  thumbnail: string;
  description: string;
}

const BASE = getApiBaseUrl();

export const TEXT_EFFECT_CATEGORIES = [
  "3d", // second most requested, used in thumbnails + titles
  "neon", // highest demand on CapCut, defines "creator aesthetic"
  "essentials", // plain bold/clean text — every editor's starting point
  "glitch", // VHS/retro digital — consistent top performer
  "gradient", // versatile, works across all content types
  "outline", // clean, readable, popular for captions + lower thirds
] as const;

export const TextEffectsApi = {
  // In-memory cache map to avoid duplicate network calls when users toggle effects
  _effectsCache: new Map<string, TextEffectDefinition>(),
  _lottieCache: new Map<string, any>(),

  // 0. Checks if the API is online by hitting the health endpoint
  async checkApiHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/health`, {
        headers: getApiHeaders(),
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data.status === "ok";
    } catch (e) {
      return false;
    }
  },

  // 1. Fetch summaries for category tab picker UI
  async getEffectsIndex(): Promise<TextEffectSummary[]> {
    const res = await fetch(`${BASE}/text-effects`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load effects index");
    return res.json();
  },

  async getEffectsByCategory(category: string): Promise<TextEffectSummary[]> {
    const res = await fetch(`${BASE}/text-effects/${category}`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load category manifest for: ${category}`);
    return res.json();
  },

  // 2. LAZY-LOAD heavy configurations on selection with RAM caching
  async getFullEffect(category: string, id: string): Promise<TextEffectDefinition> {
    const cacheKey = `${category}:${id}`;
    let data: TextEffectDefinition;

    if (this._effectsCache.has(cacheKey)) {
      data = this._effectsCache.get(cacheKey)!;
    } else {
      const res = await fetch(`${BASE}/text-effects/${category}/${id}`, {
        cache: "reload",
        headers: getApiHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to load heavy configuration for effect: ${id}`);

      data = convertRawConfigToDefinition(await res.json()) as TextEffectDefinition;
      this._effectsCache.set(cacheKey, data); // store normalized definition in cache
    }

    // Sync to store cache to prevent duplicate fetches & loading errors
    try {
      const { useEffectsStore } = await import("../store/effectsStore");
      useEffectsStore.setState((state) => ({
        definitions: { ...state.definitions, [id]: data as any },
      }));
    } catch (e) {
      console.warn("[TextEffectsApi] Failed to cache effect definition in store:", e);
    }

    return data;
  },

  // 3. Fetch summaries for template category tab picker UI
  async getTemplatesIndex(): Promise<TemplateDefinition[]> {
    const res = await fetch(`${BASE}/text-templates`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load templates index");
    return res.json();
  },

  async getTemplatesByCategory(category: string): Promise<TemplateDefinition[]> {
    const res = await fetch(`${BASE}/text-templates/${category}`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load templates for category: ${category}`);
    return res.json();
  },

  // 5. LAZY-LOAD heavy Lottie animations on-timeline placement with RAM caching
  async getLottieTemplate(category: string, id: string): Promise<any> {
    const cacheKey = `${category}:${id}`;
    if (this._lottieCache.has(cacheKey)) {
      return this._lottieCache.get(cacheKey)!;
    }

    const res = await fetch(`${BASE}/text-templates/${category}/${id}`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load Lottie animation payload for: ${id}`);

    const data = await res.json();
    this._lottieCache.set(cacheKey, data); // store in cache
    return data;
  },

  // Cache Management Methods

  /**
   * Clear the local in-memory caches (effects and templates)
   */
  clearLocalCache(): void {
    this._effectsCache.clear();
    this._lottieCache.clear();
  },

  /**
   * Purge the server-side KV cache
   * Requires API key with admin permissions
   */
  async purgeServerKVCache(): Promise<{ success: boolean; totalDeleted: number; results: any[] }> {
    const res = await fetch(`${BASE}/admin/purge-kv`, {
      method: "POST",
      headers: getApiHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to purge KV cache: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  /**
   * Purge the server-side Workers Cache API
   * Requires API key with admin permissions
   */
  async purgeServerCacheAPI(): Promise<{ success: boolean; purged: number; total: number }> {
    const res = await fetch(`${BASE}/admin/purge-cache`, {
      method: "POST",
      headers: getApiHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to purge Cache API: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  /**
   * Purge all caches (local + server KV + server Cache API)
   * Requires API key with admin permissions
   */
  async purgeAllCaches(): Promise<{
    local: { success: boolean };
    server: { success: boolean; cacheApi: any; kv: any };
  }> {
    // Clear ALL local caches using the centralized manager
    try {
      const { TextEffectsCacheManager } = await import("../cache/cacheManager");
      await TextEffectsCacheManager.clearAll();
    } catch (e) {
      console.error("[TextEffectsApi] Failed to clear local caches:", e);
      // Fallback to old method
      this.clearLocalCache();
    }

    // Clear server-side caches
    const res = await fetch(`${BASE}/admin/purge-all`, {
      method: "POST",
      headers: getApiHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to purge all caches: ${res.status} ${res.statusText}`);
    }

    const serverResult = await res.json();

    return {
      local: { success: true },
      server: serverResult,
    };
  },
};
