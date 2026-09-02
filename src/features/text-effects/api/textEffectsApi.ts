import { TextEffectDefinition } from "../types/types";
import { TemplateDefinition } from "@/features/text-templates/types";
import { getApiHeaders, getApiBaseUrl } from "@/lib/api";
import { convertRawConfigToDefinition } from "../lib/definitionConversion";
import type { TextTemplateArtifact } from "@clypra-studio/engine";
import { textTemplatePersistentCache } from "@/features/text-templates/cache/persistentCache";

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
  _templateEtags: new Map<string, string>(),

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
  async getEffectsIndex(options: { forceRefresh?: boolean } = {}): Promise<TextEffectSummary[]> {
    try {
      const res = await fetch(`${BASE}/text-effects`, {
        cache: options.forceRefresh ? "no-store" : "default",
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

  async getEffectsByCategory(category: string, options: { forceRefresh?: boolean } = {}): Promise<TextEffectSummary[]> {
    try {
      if (options.forceRefresh) {
        for (const key of this._effectsCache.keys()) {
          if (key.startsWith(`${category}:`)) this._effectsCache.delete(key);
        }
      }

      const res = await fetch(`${BASE}/text-effects/${category}`, {
        cache: options.forceRefresh ? "no-store" : "default",
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
  async getTemplatesIndex(options: { forceRefresh?: boolean } = {}): Promise<TemplateDefinition[]> {
    if (!options.forceRefresh) {
      const cached = await textTemplatePersistentCache.get("__catalog__", "all", undefined, { maxAgeMs: 30 * 60 * 1000 });
      if (Array.isArray(cached) && cached.length > 0) return cached as TemplateDefinition[];
    }
    // The API's canonical catalog is partitioned by category. Do not call a
    // non-existent aggregate `/text-templates` route (which returned 404 and
    // caused the editor to silently replace the remote catalog with static
    // templates). Category requests also preserve each item's revision pin.
    const categories = ["lower-third", "title-card", "caption", "callout", "social", "countdown"];
    const responses = await Promise.all(
      categories.map((category) => this.getTemplatesByCategory(category, options)),
    );
    const data = responses.flat();
    if (data.length > 0) {
      await textTemplatePersistentCache.set("__catalog__", "all", data);
    }
    return data;
  },

  async getTemplatesByCategory(category: string, options: { forceRefresh?: boolean } = {}): Promise<TemplateDefinition[]> {
    if (!options.forceRefresh) {
      const cached = await textTemplatePersistentCache.get("__catalog__", category, undefined, { maxAgeMs: 30 * 60 * 1000 });
      if (Array.isArray(cached) && cached.length > 0) return cached as TemplateDefinition[];
    }
    const res = await fetch(`${BASE}/text-templates/${category}`, {
      headers: getApiHeaders(),
      cache: options.forceRefresh ? "no-store" : "default",
    });
    if (!res.ok) throw new Error(`Failed to load templates for category: ${category}`);
    const data = (await res.json()) as TemplateDefinition[];
    if (Array.isArray(data) && data.length > 0) {
      await textTemplatePersistentCache.set("__catalog__", category, data);
    }
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
    if (!options.forceRefresh) {
      const persistent = await textTemplatePersistentCache.get(category, id, options.revisionId);
      if (persistent && !Array.isArray(persistent)) {
        this._templateCache.set(cacheKey, persistent);
        return persistent;
      }
    }
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
    await textTemplatePersistentCache.set(
      category,
      id,
      data,
      options.revisionId ?? data?.revisionId ?? data?.revision?.revisionId,
      data?.contentHash ?? data?.revision?.contentHash,
    );
    return data;
  },

  /** Load the canonical artifact by exact revision for immutable timeline instances. */
  async getTemplateArtifact(category: string, id: string, revisionId?: string): Promise<TextTemplateArtifact> {
    const cacheKey = `${category}:${id}:${revisionId || "latest"}`;
    const persistent = await textTemplatePersistentCache.get(category, id, revisionId);
    if (persistent && !Array.isArray(persistent) && (persistent as any).kind === "text-template") {
      this._templateCache.set(cacheKey, persistent);
      return persistent as TextTemplateArtifact;
    }
    const endpoint = revisionId
      ? `${BASE}/text-templates/${category}/${id}/revisions/${revisionId}`
      : `${BASE}/text-templates/${category}/${id}`;
    const headers = { ...getApiHeaders() } as Record<string, string>;
    const etag = this._templateEtags.get(cacheKey);
    if (etag) headers["If-None-Match"] = etag;
    const response = await fetch(endpoint, { headers });
    if (response.status === 304) {
      const cached = this._templateCache.get(cacheKey);
      if (cached?.kind === "text-template") return cached as TextTemplateArtifact;
    }
    if (!response.ok) throw new Error(`Failed to load template artifact: ${id}`);
    const artifact = await response.json() as TextTemplateArtifact;
    const responseEtag = response.headers.get("ETag");
    if (responseEtag) this._templateEtags.set(cacheKey, responseEtag);
    this._templateCache.set(cacheKey, artifact);
    await textTemplatePersistentCache.set(category, id, artifact, revisionId ?? artifact.revision?.revisionId, artifact.revision?.contentHash);
    return artifact;
  },

  async submitTextTemplate(artifact: TextTemplateArtifact, media: { thumbnailDataUrl?: string; previewDataUrl?: string } = {}): Promise<any> {
    const idempotencyKey = `template-submit:${artifact.metadata.id}:${artifact.revision.contentHash}:${Date.now()}`;
    const response = await fetch(`${BASE}/text-templates/submissions`, {
      method: "POST",
      headers: { ...getApiHeaders(), "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ artifact, ...media }),
    });
    if (!response.ok) throw new Error(`Template submission failed: ${response.status}`);
    return response.json();
  },

  // Cache Management Methods

  /**
   * Clear the local in-memory caches (effects and templates)
   */
  clearLocalCache(): void {
    this._effectsCache.clear();
    this.clearTemplateCache();
  },

  /** Clear only the in-memory template payload and validator caches. */
  clearTemplateCache(): void {
    this._templateCache.clear();
    this._templateEtags.clear();
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

  /**
   * Clear all local caches (memory, IndexedDB, localStorage) and hard re-fetch
   * all Text Effects & Text Templates from the server.
   */
  async hardReloadAllTextData(): Promise<{ effectsCount: number; templatesCount: number }> {
    console.log("[TextEffectsApi] 🔄 Initiating Hard Reload for all Text Effects & Templates...");
    this.clearLocalCache();

    // Clear feature cache in localStorage and persistent IndexedDB
    try {
      const { TextEffectsCacheManager } = await import("../cache/cacheManager");
      await TextEffectsCacheManager.clearAll();
    } catch (e) {
      console.warn("[TextEffectsApi] Failed to clear effects cache manager:", e);
    }

    try {
      const { TextTemplatesCacheManager } = await import("@/features/text-templates/cache/cacheManager");
      await TextTemplatesCacheManager.clearAll();
    } catch (e) {
      console.warn("[TextEffectsApi] Failed to clear templates cache manager:", e);
    }

    // Force re-fetch templates
    let templatesCount = 0;
    try {
      const { useTemplateStore } = await import("@/features/text-templates/templateStore");
      const templates = await this.getTemplatesIndex({ forceRefresh: true });
      templatesCount = templates.length;
      useTemplateStore.setState({
        templates,
        isApiConnected: true,
        isLoading: false,
      });
    } catch (err) {
      console.warn("[TextEffectsApi] Failed to reload templates during hard reload:", err);
    }

    // Force re-fetch effects
    let effectsCount = 0;
    try {
      const { useEffectsStore } = await import("../store/effectsStore");
      const effectCategories = ["essentials", "glow", "gradient", "cyberpunk", "retro", "neon", "minimal"];
      const effectResults = await Promise.allSettled(
        effectCategories.map((cat) => this.getEffectsByCategory(cat, { forceRefresh: true })),
      );
      const newIndex: Record<string, any[]> = {};
      for (let i = 0; i < effectCategories.length; i++) {
        const cat = effectCategories[i];
        const res = effectResults[i];
        if (res.status === "fulfilled") {
          newIndex[cat] = res.value;
          effectsCount += res.value.length;
        }
      }
      useEffectsStore.setState((state) => ({
        index: { ...state.index, ...newIndex },
        indexLoading: false,
        indexError: null,
      }));
    } catch (err) {
      console.warn("[TextEffectsApi] Failed to reload effects during hard reload:", err);
    }

    console.log(`[TextEffectsApi] ✅ Hard Reload complete: ${effectsCount} effects, ${templatesCount} templates`);
    return { effectsCount, templatesCount };
  },
};

