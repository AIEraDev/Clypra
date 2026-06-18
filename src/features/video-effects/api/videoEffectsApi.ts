/**
 * Clypra Video Effects API Client
 *
 * Handles fetching:
 * 1. Video Effects (renderer-based effects)
 * 2. Body Effects (ML-powered effects)
 */

import { VideoEffectManifest, VideoEffectItem, EffectPreset, VideoEffectCategory, EffectCategory } from "../types";
import { getApiHeaders, getApiBaseUrl } from "@/lib/api";

const BASE = getApiBaseUrl();

export class VideoEffectsApi {
  // In-memory caches
  private static _manifestCache: VideoEffectManifest | null = null;
  private static _categoryCache = new Map<string, VideoEffectItem[]>();
  private static _itemCache = new Map<string, VideoEffectItem>();
  private static _blobCache = new Map<string, Blob>();

  // ============================================================================
  // VIDEO EFFECTS & BODY EFFECTS API
  // ============================================================================

  /**
   * Fetch the video effects manifest with all available effects
   */
  static async getVideoEffectsManifest(): Promise<any> {
    const res = await fetch(`${BASE}/video-effects/manifest`, {
      cache: "reload",
      headers: getApiHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to load video effects manifest: ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Fetch the body effects manifest with all available categories and counts
   */
  static async getBodyEffectsManifest(): Promise<any> {
    const res = await fetch(`${BASE}/body-effects/manifest`, {
      cache: "reload",
      headers: getApiHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to load body effects manifest: ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Fetch all renderer-based video effects
   */
  static async getRendererEffects(): Promise<EffectPreset[]> {
    const res = await fetch(`${BASE}/body-effects/video`, {
      cache: "reload",
      headers: getApiHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to load renderer effects: ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Fetch renderer-based effects by category
   */
  static async getRendererEffectsByCategory(category: string): Promise<EffectPreset[]> {
    const res = await fetch(`${BASE}/video-effects/${category}`, {
      cache: "reload",
      headers: getApiHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to load ${category} effects: ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Fetch a specific renderer-based effect by ID
   */
  static async getRendererEffectById(id: string): Promise<EffectPreset> {
    const res = await fetch(`${BASE}/body-effects/${id}`, {
      cache: "reload",
      headers: getApiHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to load effect "${id}": ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Download effect preview video (.webm)
   */
  static async downloadEffectPreview(effectId: string, category: string): Promise<Blob> {
    // Check cache first
    const cacheKey = `effect-preview:${effectId}`;
    if (this._blobCache.has(cacheKey)) {
      return this._blobCache.get(cacheKey)!;
    }

    const res = await fetch(`https://raw.githubusercontent.com/AIEraDev/clypra-api/main/public/effect-previews/${category}/${effectId}.webm`, { headers: getApiHeaders() });

    if (!res.ok) {
      throw new Error(`Failed to download preview for effect "${effectId}": ${res.statusText}`);
    }

    const blob = await res.blob();
    this._blobCache.set(cacheKey, blob);
    return blob;
  }

  /**
   * Get effect preview as Object URL
   */
  static async getEffectPreviewObjectURL(effectId: string, category: string): Promise<string> {
    const blob = await this.downloadEffectPreview(effectId, category);
    return URL.createObjectURL(blob);
  }

  /**
   * Search renderer-based effects
   */
  static async searchRendererEffects(query: string): Promise<EffectPreset[]> {
    const res = await fetch(`${BASE}/video-effects/search?q=${encodeURIComponent(query)}`, {
      headers: getApiHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Search failed: ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Fetch all body effects
   */
  static async getBodyEffects(): Promise<EffectPreset[]> {
    const res = await fetch(`${BASE}/body-effects/body`, {
      cache: "reload",
      headers: getApiHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to load body effects: ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Fetch a specific effect by ID
   */
  static async getEffectById(id: string): Promise<EffectPreset> {
    const res = await fetch(`${BASE}/body-effects/${id}`, {
      cache: "reload",
      headers: getApiHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to load effect "${id}": ${res.statusText}`);
    }

    return res.json();
  }

  // ============================================================================
  // CACHE MANAGEMENT
  // ============================================================================

  /**
   * Clear all local caches
   */
  static clearLocalCache(): void {
    this._manifestCache = null;
    this._categoryCache.clear();
    this._itemCache.clear();

    // Revoke all Object URLs before clearing blob cache
    this._blobCache.forEach((blob) => {
      URL.revokeObjectURL(URL.createObjectURL(blob));
    });
    this._blobCache.clear();
  }

  /**
   * Get cache stats (for debugging)
   */
  static getCacheStats(): {
    manifestCached: boolean;
    categoriesCached: number;
    itemsCached: number;
    blobsCached: number;
    totalBlobSizeMB: number;
  } {
    let totalSize = 0;
    this._blobCache.forEach((blob) => {
      totalSize += blob.size;
    });

    return {
      manifestCached: this._manifestCache !== null,
      categoriesCached: this._categoryCache.size,
      itemsCached: this._itemCache.size,
      blobsCached: this._blobCache.size,
      totalBlobSizeMB: totalSize / (1024 * 1024),
    };
  }
}
