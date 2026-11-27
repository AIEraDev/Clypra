/**
 * Clip Download Store
 *
 * Zustand store tracking in-flight and completed clip downloads.
 * Each entry represents one ClipItem download lifecycle.
 *
 * The epoch guard is enforced by the add-to-timeline action (C8),
 * not here — this store is only concerned with download state.
 */

import { create } from "zustand";
import type { ClipDownloadState, ClipItem } from "../types";
import { downloadClip } from "../download/clipDownloader";
import {
  HashMismatchError,
  DownloadAbortedError,
  DiskFullError,
} from "../types";

interface ClipDownloadStoreState {
  /** Download states keyed by clip ID */
  downloads: Record<string, ClipDownloadState>;

  /**
   * Start downloading a clip.
   * Resolves with the absolute local path on success.
   * Throws HashMismatchError | DownloadAbortedError | DiskFullError | Error on failure.
   */
  startDownload(item: ClipItem): Promise<string>;

  /** Cancel an in-progress download for the given clip ID */
  cancelDownload(clipId: string): void;

  /** Get the current download state for a clip (undefined if never started) */
  getDownloadState(clipId: string): ClipDownloadState | undefined;

  /** Whether the clip has been downloaded and is ready */
  isReady(clipId: string): boolean;

  /** Internal: update progress for a downloading clip */
  _setProgress(clipId: string, progress: number): void;

  /** Internal: mark a download as complete with its local path */
  _setReady(clipId: string, localPath: string): void;

  /** Internal: mark a download as errored */
  _setError(clipId: string, error: string): void;
}

/** Active AbortControllers keyed by clip ID */
const abortControllers = new Map<string, AbortController>();

export const useClipDownloadStore = create<ClipDownloadStoreState>(
  (set, get) => ({
    downloads: {},

    async startDownload(item: ClipItem): Promise<string> {
      const { downloads } = get();

      // Already ready — return cached path
      const existing = downloads[item.id];
      if (existing?.status === "ready" && existing.localPath) {
        return existing.localPath;
      }

      // Already downloading — don't start a second download
      if (existing?.status === "downloading") {
        // Wait for the existing download via polling
        return new Promise((resolve, reject) => {
          const interval = setInterval(() => {
            const state = get().downloads[item.id];
            if (!state) {
              clearInterval(interval);
              reject(new DownloadAbortedError(item.id));
              return;
            }
            if (state.status === "downloading") return;
            clearInterval(interval);
            if (state.status === "ready" && state.localPath) {
              resolve(state.localPath);
            } else {
              reject(new Error(state.error ?? "Download failed"));
            }
          }, 200);
        });
      }

      // Create AbortController for cancellation
      const controller = new AbortController();
      abortControllers.set(item.id, controller);

      // Set to downloading
      set((s) => ({
        downloads: {
          ...s.downloads,
          [item.id]: {
            clipId: item.id,
            status: "downloading",
            progress: 0,
          },
        },
      }));

      try {
        const localPath = await downloadClip(
          item,
          controller.signal,
          (pct) => get()._setProgress(item.id, pct),
        );
        get()._setReady(item.id, localPath);
        abortControllers.delete(item.id);
        return localPath;
      } catch (err) {
        abortControllers.delete(item.id);
        if (err instanceof DownloadAbortedError) {
          throw err;
        }
        const msg =
          err instanceof HashMismatchError
            ? err.message
            : err instanceof DiskFullError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Download failed";
        get()._setError(item.id, msg);
        throw err;
      }
    },

    cancelDownload(clipId: string): void {
      const controller = abortControllers.get(clipId);
      if (controller) {
        controller.abort();
        abortControllers.delete(clipId);
      }
      set((s) => {
        const { [clipId]: _removed, ...rest } = s.downloads;
        return { downloads: rest };
      });
    },

    getDownloadState(clipId: string): ClipDownloadState | undefined {
      return get().downloads[clipId];
    },

    isReady(clipId: string): boolean {
      return get().downloads[clipId]?.status === "ready";
    },

    _setProgress(clipId: string, progress: number): void {
      set((s) => {
        const existing = s.downloads[clipId];
        if (!existing || existing.status !== "downloading") return s;
        return {
          downloads: {
            ...s.downloads,
            [clipId]: { ...existing, progress },
          },
        };
      });
    },

    _setReady(clipId: string, localPath: string): void {
      set((s) => ({
        downloads: {
          ...s.downloads,
          [clipId]: {
            clipId,
            status: "ready",
            progress: 100,
            localPath,
          },
        },
      }));
    },

    _setError(clipId: string, error: string): void {
      set((s) => ({
        downloads: {
          ...s.downloads,
          [clipId]: {
            clipId,
            status: "error",
            progress: 0,
            error,
          },
        },
      }));
    },
  }),
);
