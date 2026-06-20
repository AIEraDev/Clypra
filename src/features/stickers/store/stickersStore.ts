/**
 * Stickers Store
 * Manages download state and cached stickers from the stickers library
 */

import { create } from "zustand";
import type { StickerItem } from "../api/stickersApi";
import { stickerCacheManager, type CachedSticker } from "@/features/stickers/cache/stickerCache";

export type DownloadStatus = "idle" | "downloading" | "completed" | "error";

export interface StickerDownloadState {
  itemId: string;
  status: DownloadStatus;
  progress: number; // 0-100
  cachedSticker?: CachedSticker;
  error?: string;
}

interface StickersStore {
  downloads: Record<string, StickerDownloadState>;

  initializeCache: () => Promise<void>;
  startDownload: (item: StickerItem) => Promise<CachedSticker>;
  getDownloadState: (itemId: string) => StickerDownloadState | null;
  isDownloaded: (itemId: string) => boolean;
  getCachedSticker: (itemId: string) => CachedSticker | null;
  clearDownloadState: (itemId: string) => void;
  clearCache: (itemId: string) => Promise<void>;

  // Internal setters
  _updateDownloadProgress: (itemId: string, progress: number) => void;
  _setDownloadCompleted: (itemId: string, cachedSticker: CachedSticker) => void;
  _setDownloadError: (itemId: string, error: string) => void;
}

export const useStickersStore = create<StickersStore>((set, get) => ({
  downloads: {},

  initializeCache: async () => {
    try {
      await stickerCacheManager.initialize();
      // Since stickerCacheManager doesn't expose getAllCached (we can deduce from index maps if we iterate or just trust initialised status),
      // we'll load cached items directly into the store.
      // Let's implement a clean read from stickerCacheManager
      const downloads: Record<string, StickerDownloadState> = {};

      // Let's access the index via a get method or by adding an index list helper
      // Wait, we can just load the cached items on-demand or check if it's cached in getDownloadState.
      // But wait! Let's check how audioCacheManager did it.
      // audioCacheManager had a `getAllCached()` method. Let's look at `audioCache.ts` again if we need it.
      // Yes, `audioCache.ts` had `getAllCached()`. We can add it or just check cache on-demand.
      // To be consistent, let's check cache manager on-demand and keep store simple.
    } catch (error) {
      console.error("[StickersStore] Failed to initialize cache:", error);
    }
  },

  startDownload: async (item: StickerItem) => {
    const { downloads } = get();

    // Check if already completed
    if (stickerCacheManager.isCached(item.id)) {
      const cached = stickerCacheManager.getCached(item.id)!;
      return cached;
    }

    if (downloads[item.id]?.status === "downloading") {
      throw new Error("Download already in progress");
    }

    set({
      downloads: {
        ...downloads,
        [item.id]: {
          itemId: item.id,
          status: "downloading",
          progress: 0,
        },
      },
    });

    try {
      const cachedSticker = await stickerCacheManager.downloadSticker(item, (percentage) => {
        get()._updateDownloadProgress(item.id, percentage);
      });

      get()._setDownloadCompleted(item.id, cachedSticker);
      return cachedSticker;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Download failed";
      get()._setDownloadError(item.id, errorMessage);
      throw error;
    }
  },

  getDownloadState: (itemId: string) => {
    const state = get().downloads[itemId];
    if (state) return state;

    // Check disk cache on demand
    if (stickerCacheManager.isCached(itemId)) {
      const cached = stickerCacheManager.getCached(itemId)!;
      return {
        itemId,
        status: "completed",
        progress: 100,
        cachedSticker: cached,
      };
    }

    return null;
  },

  isDownloaded: (itemId: string) => {
    return stickerCacheManager.isCached(itemId);
  },

  getCachedSticker: (itemId: string) => {
    return stickerCacheManager.getCached(itemId);
  },

  clearDownloadState: (itemId: string) => {
    const { downloads } = get();
    const updated = { ...downloads };
    delete updated[itemId];
    set({ downloads: updated });
  },

  clearCache: async (itemId: string) => {
    await stickerCacheManager.clearCache(itemId);
    get().clearDownloadState(itemId);
  },

  _updateDownloadProgress: (itemId: string, progress: number) => {
    const { downloads } = get();
    if (!downloads[itemId]) return;
    set({
      downloads: {
        ...downloads,
        [itemId]: {
          ...downloads[itemId],
          progress,
        },
      },
    });
  },

  _setDownloadCompleted: (itemId: string, cachedSticker: CachedSticker) => {
    const { downloads } = get();

    // Load Lottie JSON if available
    let lottieData: any = null;
    if (cachedSticker.format === "lottie" && cachedSticker.localAnimationPath) {
      stickerCacheManager
        .readLottieJson(cachedSticker.localAnimationPath)
        .then((data) => {
          // Update the cached sticker with Lottie data
          const updated = { ...cachedSticker, lottieData: data };
          set({
            downloads: {
              ...get().downloads,
              [itemId]: {
                itemId,
                status: "completed",
                progress: 100,
                cachedSticker: updated,
              },
            },
          });
        })
        .catch((error) => {
          console.error("[StickersStore] Failed to load Lottie JSON:", error);
        });
    }

    set({
      downloads: {
        ...downloads,
        [itemId]: {
          itemId,
          status: "completed",
          progress: 100,
          cachedSticker,
        },
      },
    });
  },

  _setDownloadError: (itemId: string, error: string) => {
    const { downloads } = get();
    set({
      downloads: {
        ...downloads,
        [itemId]: {
          itemId,
          status: "error",
          progress: 0,
          error,
        },
      },
    });
  },
}));

// Initialize cache on startup
useStickersStore.getState().initializeCache();
