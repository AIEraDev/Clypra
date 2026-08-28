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
  schemaVersion?: number;
  revisionId?: string;
  contentHash?: string;
  rendererVersion?: string;
  revision?: {
    revisionId?: string;
    contentHash?: string;
    rendererVersion?: string;
  };
}

const BASE = getApiBaseUrl();

export {
  TEXT_EFFECT_CATEGORY_IDS,
  type TextEffectCategoryId,
  TEXT_EFFECT_CATEGORY_OPTIONS,
  TEXT_EFFECT_CATEGORIES,
} from "@/constants/textEffectCategories";

export const TextEffectsApi = {
  // In-memory cache map to avoid duplicate network calls when users toggle effects
  _effectsCache: new Map<string, TextEffectDefinition>(),
  _templateCache: new Map<string, any>(),

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
    try {
      const res = await fetch(`${BASE}/text-effects`, {
        headers: getApiHeaders(),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        console.error(`[TextEffectsApi] Failed to load effects index:`, {
          status: res.status,
          statusText: res.statusText,
          error: errorText,
        });
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }

      return res.json();
    } catch (error) {
      console.error(`[TextEffectsApi] Exception loading effects index:`, error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Network error: ${String(error)}`);
    }
  },

  async getEffectsByCategory(category: string): Promise<TextEffectSummary[]> {
    try {
      const res = await fetch(`${BASE}/text-effects/${category}`, {
        headers: getApiHeaders(),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        console.error(`[TextEffectsApi] Failed to load category ${category}:`, {
          status: res.status,
          statusText: res.statusText,
          error: errorText,
        });
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }

      const data = await res.json();
      // A catalog republish may keep the same asset id. Evict only the
      // unpinned latest entry when the manifest advertises a new revision;
      // revision-specific entries remain valid and immutable.
      for (const item of data as TextEffectSummary[]) {
        const cacheKey = `${category}:${item.id}:latest`;
        const cached = this._effectsCache.get(cacheKey) as any;
        const cachedRevisionId = cached?.revisionId ?? cached?.revision?.revisionId;
        const manifestRevisionId = item.revisionId ?? item.revision?.revisionId;
        if (cached && manifestRevisionId && cachedRevisionId !== manifestRevisionId) {
          this._effectsCache.delete(cacheKey);
        }
      }
      console.log(`[TextEffectsApi] Successfully loaded ${data.length} effects for category: ${category}`);
      return data;
    } catch (error) {
      console.error(`[TextEffectsApi] Exception loading category ${category}:`, error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Network error: ${String(error)}`);
    }
  },

  // 2. LAZY-LOAD heavy configurations on selection with RAM caching
  async getFullEffect(
    category: string,
    id: string,
    options: { forceRefresh?: boolean; revisionId?: string } = {},
  ): Promise<TextEffectDefinition> {
    const cacheKey = `${category}:${id}:${options.revisionId || "latest"}`;
    let data: TextEffectDefinition;

    if (!options.forceRefresh && this._effectsCache.has(cacheKey)) {
      data = this._effectsCache.get(cacheKey)!;
    } else {
      const endpoint = options.revisionId
        ? `${BASE}/text-effects/${category}/${id}/revisions/${options.revisionId}`
        : `${BASE}/text-effects/${category}/${id}`;
      const res = await fetch(endpoint, {
        cache: options.forceRefresh ? "no-store" : "default",
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
        definitionRevisions: {
          ...state.definitionRevisions,
          [id]: {
            revisionId: (data as any).revisionId ?? (data as any).revision?.revisionId,
            contentHash: (data as any).contentHash ?? (data as any).revision?.contentHash,
          },
        },
      }));
    } catch (e) {
      console.warn("[TextEffectsApi] Failed to cache effect definition in store:", e);
    }

    return data;
  },

  // 3. Fetch summaries for template category tab picker UI
  async getTemplatesIndex(): Promise<TemplateDefinition[]> {
    const res = await fetch(`${BASE}/text-templates`, {
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load templates index");
    return res.json();
  },

  async getTemplatesByCategory(category: string): Promise<TemplateDefinition[]> {
    const res = await fetch(`${BASE}/text-templates/${category}`, {
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load templates for category: ${category}`);
    const data = await res.json() as TemplateDefinition[];
    for (const item of data as any[]) {
      const cacheKey = `${category}:${item.id}:latest`;
      const cached = this._templateCache.get(cacheKey);
      const cachedRevisionId = cached?.revisionId ?? cached?.revision?.revisionId;
      const manifestRevisionId = item.revisionId ?? item.revision?.revisionId;
      if (cached && manifestRevisionId && cachedRevisionId !== manifestRevisionId) {
        this._templateCache.delete(cacheKey);
      }
    }
    return data;
  },

  // 5. LAZY-LOAD heavy canvas templates on-timeline placement with RAM caching
  async getTemplateData(category: string, id: string, options: { forceRefresh?: boolean; revisionId?: string } = {}): Promise<any> {
    const cacheKey = `${category}:${id}:${options.revisionId || "latest"}`;
    if (!options.forceRefresh && this._templateCache.has(cacheKey)) {
      return this._templateCache.get(cacheKey)!;
    }

    const endpoint = options.revisionId
      ? `${BASE}/text-templates/${category}/${id}/revisions/${options.revisionId}`
      : `${BASE}/text-templates/${category}/${id}`;
    const res = await fetch(endpoint, {
      cache: options.forceRefresh ? "no-store" : "default",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load template payload for: ${id}`);

    const data = await res.json();
    this._templateCache.set(cacheKey, data); // store in cache
    return data;
  },

  // Cache Management Methods

  /**
   * Clear the local in-memory caches (effects and templates)
   */
  clearLocalCache(): void {
    this._effectsCache.clear();
    this._templateCache.clear();
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
