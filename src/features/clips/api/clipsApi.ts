/**
 * Clips API module
 *
 * Fetches the clip catalog from clypra-api /clips with ETag revalidation.
 * Falls back to an empty array on network errors (no bundled starters —
 * clips require a network download, so we show the offline state).
 *
 * Uses the same ETag + If-None-Match pattern as StickersApi.
 */

import { getApiBaseUrl, getApiHeaders } from "@/lib/api";
import type { ClipItem, ClipCategory } from "../types";

const BASE = `${getApiBaseUrl()}/api/v1`;

/** In-memory ETag cache (keyed by request fingerprint) */
const etagCache = new Map<string, { etag: string; data: ClipItem[] }>();

export const ClipsApi = {
  /**
   * Fetch the full clip index with ETag revalidation.
   * Returns [] on network error (caller should show offline state).
   */
  async getClipsIndex(): Promise<ClipItem[]> {
    const cacheKey = "root";
    const cached = etagCache.get(cacheKey);

    try {
      const headers: Record<string, string> = {
        ...(getApiHeaders() as Record<string, string>),
        ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
      };

      const res = await fetch(`${BASE}/clips`, { headers });

      if (res.status === 304 && cached) {
        return cached.data;
      }

      if (!res.ok) {
        console.warn(
          `[ClipsApi] HTTP ${res.status} on /clips; showing offline state`,
        );
        return cached?.data ?? [];
      }

      const responseEtag = res.headers.get("ETag");
      const json = await res.json();
      const list: ClipItem[] = Array.isArray(json)
        ? json
        : Array.isArray(json?.clips)
          ? json.clips
          : [];

      if (responseEtag) {
        etagCache.set(cacheKey, { etag: responseEtag, data: list });
      }
      return list;
    } catch (err) {
      console.warn(
        `[ClipsApi] Network error fetching /clips:`,
        err instanceof Error ? err.message : err,
      );
      return cached?.data ?? [];
    }
  },

  /**
   * Fetch clips for a single category with ETag revalidation.
   * Returns [] on network error.
   */
  async getClipsByCategory(category: ClipCategory | string): Promise<ClipItem[]> {
    const cacheKey = `category:${category}`;
    const cached = etagCache.get(cacheKey);

    try {
      const headers: Record<string, string> = {
        ...(getApiHeaders() as Record<string, string>),
        ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
      };

      const res = await fetch(`${BASE}/clips/${category}`, { headers });

      if (res.status === 304 && cached) {
        return cached.data;
      }

      if (!res.ok) {
        console.warn(
          `[ClipsApi] HTTP ${res.status} on /clips/${category}; showing offline state`,
        );
        return cached?.data ?? [];
      }

      const responseEtag = res.headers.get("ETag");
      const json = await res.json();
      const list: ClipItem[] = Array.isArray(json)
        ? json
        : Array.isArray(json?.clips)
          ? json.clips
          : [];

      if (responseEtag) {
        etagCache.set(cacheKey, { etag: responseEtag, data: list });
      }
      return list;
    } catch (err) {
      console.warn(
        `[ClipsApi] Network error fetching /clips/${category}:`,
        err instanceof Error ? err.message : err,
      );
      return cached?.data ?? [];
    }
  },

  /**
   * Returns [] — there are no offline fallback clips.
   * Clips require a network download; the tab shows the offline state instead.
   */
  getOfflineFallback(): ClipItem[] {
    return [];
  },

  /** Clear the ETag cache (used in tests) */
  _clearCache(): void {
    etagCache.clear();
  },
} as const;
