export type StickerCategory =
  | "reaction"
  | "emoji"
  | "social"
  | "arrow"
  | "shape"
  | "frame"
  | "callout"
  | "celebration"
  | "nature"
  | "object"
  | "misc";

export interface StickerItem {
  id: string;
  name: string;
  category: StickerCategory | string;
  thumbnailUrl: string;
  lottieUrl?: string;
  primaryUrl?: string;
  preview?: string;
  isPremium?: boolean;
  tags?: string[];
  kind?: "lottie" | "webp" | "png" | "svg";
  animated?: boolean;
  sha256?: string;
  bytes?: number;
  dimensions?: { width: number; height: number };
  animation?: {
    durationMs: number;
    fps: number;
    loop: boolean;
    lottie?: { layerCount: number; hasExpressions: boolean };
  };
  license?: {
    spdx: string;
    author: string;
    sourceUrl?: string;
    attributionRequired: boolean;
    attributionText?: string;
    modified?: boolean;
  };
}

import { getApiHeaders, getApiBaseUrl } from "@/lib/api";
import { getStarterStickers } from "../starterStickers";

const BASE = getApiBaseUrl();

export const STICKER_CATEGORIES: StickerCategory[] = [
  "reaction",
  "emoji",
  "social",
  "arrow",
  "shape",
  "frame",
  "callout",
  "celebration",
  "nature",
  "object",
  "misc",
];

// In-memory cache for ETags and index payloads
const etagCache: Map<string, { etag: string; data: StickerItem[] }> = new Map();

export const StickersApi = {
  /**
   * Fetches the sticker catalog index with ETag revalidation and starter fallback.
   */
  async getStickersIndex(options?: {
    category?: string;
    tag?: string;
    kind?: string;
  }): Promise<StickerItem[]> {
    const params = new URLSearchParams();
    if (options?.category) params.set("category", options.category);
    if (options?.tag) params.set("tag", options.tag);
    if (options?.kind) params.set("kind", options.kind);

    const cacheKey = params.toString() || "root";
    const cached = etagCache.get(cacheKey);

    try {
      const headers: Record<string, string> = {
        ...(getApiHeaders() as Record<string, string>),
        ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
      };

      const url = `${BASE}/stickers${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { headers });

      if (res.status === 304 && cached) {
        return cached.data;
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        console.warn(`[StickersApi] HTTP ${res.status}: ${errorText}; falling back to starter stickers`);
        return this.getOfflineFallback(options?.category);
      }

      const responseEtag = res.headers.get("ETag");
      const data = await res.json();
      const list: StickerItem[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.stickers)
          ? data.stickers
          : [];

      // Combine with starter stickers if catalog is small or offline
      const combined = this.mergeWithStarters(list, options?.category);

      if (responseEtag) {
        etagCache.set(cacheKey, { etag: responseEtag, data: combined });
      }

      return combined;
    } catch (error) {
      console.warn(`[StickersApi] Network error fetching stickers: ${error}; using starter stickers`);
      return this.getOfflineFallback(options?.category);
    }
  },

  /**
   * Fetches stickers filtered by category with ETag revalidation.
   */
  async getStickersByCategory(category: StickerCategory): Promise<StickerItem[]> {
    const cacheKey = `category:${category}`;
    const cached = etagCache.get(cacheKey);

    try {
      const headers: Record<string, string> = {
        ...(getApiHeaders() as Record<string, string>),
        ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
      };

      const res = await fetch(`${BASE}/stickers/${category}`, { headers });

      if (res.status === 304 && cached) {
        return cached.data;
      }

      if (!res.ok) {
        return this.getOfflineFallback(category);
      }

      const responseEtag = res.headers.get("ETag");
      const data = await res.json();
      const list: StickerItem[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.stickers)
          ? data.stickers
          : [];

      const combined = this.mergeWithStarters(list, category);

      if (responseEtag) {
        etagCache.set(cacheKey, { etag: responseEtag, data: combined });
      }

      return combined;
    } catch (error) {
      return this.getOfflineFallback(category);
    }
  },

  /**
   * Fetches single sticker manifest by ID.
   */
  async getSticker(id: string): Promise<StickerItem> {
    // Check bundled starter stickers first
    const starters = getStarterStickers();
    const foundStarter = starters.find((s) => s.id === id);
    if (foundStarter) return foundStarter;

    try {
      const res = await fetch(`${BASE}/stickers/${id}`, {
        headers: getApiHeaders(),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return res.json();
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error(`Network error: ${String(error)}`);
    }
  },

  mergeWithStarters(apiList: StickerItem[], categoryFilter?: string): StickerItem[] {
    const starters = getStarterStickers();
    const filteredStarters = categoryFilter
      ? starters.filter((s) => s.category.toLowerCase() === categoryFilter.toLowerCase())
      : starters;

    const seenIds = new Set(apiList.map((s) => s.id));
    const merged = [...apiList];

    for (const starter of filteredStarters) {
      if (!seenIds.has(starter.id)) {
        merged.push(starter);
        seenIds.add(starter.id);
      }
    }

    return merged;
  },

  getOfflineFallback(categoryFilter?: string): StickerItem[] {
    const starters = getStarterStickers();
    if (!categoryFilter) return starters;
    return starters.filter((s) => s.category.toLowerCase() === categoryFilter.toLowerCase());
  },
};
