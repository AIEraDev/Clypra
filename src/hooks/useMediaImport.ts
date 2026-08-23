import { useState } from "react";
import { useProjectStore } from "../store/projectStore";
import type { MediaAsset } from "../types";
import { generateSimpleWaveform } from "../lib/audio/audioWaveformGenerator";
import { generateId } from "@/lib/utils/id";
import { platform } from "@/core/platform";
import { DEFAULT_STILL_DURATION_SECONDS } from "../constants/config";
import { toast } from "@/lib/toast";

const CONCURRENCY_LIMIT = 4;

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (currentIndex < items.length) {
        const index = currentIndex++;
        results[index] = await fn(items[index]);
      }
    }
  );

  await Promise.all(workers);
  return results;
}

export const useMediaImport = () => {
  const [isLoading, setIsLoading] = useState(false);
  const { addMediaAsset, updateMediaAsset } = useProjectStore();

  const getMediaType = (path: string): "video" | "audio" | "image" => {
    const lower = path.toLowerCase();
    if (/\.(mp4|mov|mkv|webm|m4v|flv)$/i.test(lower)) return "video";
    if (/\.(mp3|wav|aac|ogg|flac|m4a)$/i.test(lower)) return "audio";
    return "image";
  };

  const importMedia = async () => {
    try {
      setIsLoading(true);
      const selected = await platform.openFileDialog({
        multiple: true,
        filters: [
          {
            name: "Media",
            extensions: ["mp4", "mov", "mkv", "webm", "m4v", "mp3", "wav", "aac", "ogg", "flac", "m4a", "jpg", "png", "webp"],
          },
        ],
      });

      if (!selected || selected.length === 0) return;

      let importedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      await mapConcurrent(selected, CONCURRENCY_LIMIT, async (file) => {
        try {
          const currentAssets = useProjectStore.getState().mediaAssets;
          const existingAsset = currentAssets.find((a) => a.path === file.path || a.name === file.name);
          if (existingAsset) {
            skippedCount++;
            return;
          }

          const type = getMediaType(file.name);

          try {
            // Phase 1 (Instant): Probe metadata and immediately create asset
            const metadata = await platform.getMediaMetadata(file.path);

            let initialPoster: string | undefined;
            if (type === "audio") {
              initialPoster = generateSimpleWaveform({
                width: 160,
                height: 90,
                barCount: 32,
                barColor: "#22d3ee",
                backgroundColor: "#1e293b",
              });
            } else if (type === "image") {
              initialPoster = platform.convertFileSrc(file.path);
            }

            const asset: MediaAsset = {
              id: generateId("asset"),
              name: file.name,
              path: file.path,
              type,
              duration: type === "image" ? DEFAULT_STILL_DURATION_SECONDS : metadata.duration,
              width: type === "audio" ? 0 : metadata.width,
              height: type === "audio" ? 0 : metadata.height,
              posterFrame: initialPoster,
              size: file.size || (metadata as any).size || 0,
            };

            addMediaAsset(asset);
            importedCount++;

            // Phase 2 (Async Background): Extract poster/cover art without blocking UI
            if (type === "video") {
              platform
                .extractPosterFrame(file.path, metadata.duration, window.devicePixelRatio || 1.0)
                .then((poster) => {
                  if (poster) {
                    useProjectStore.getState().updateMediaAsset(asset.id, { posterFrame: poster });
                  }
                })
                .catch((err) => {
                  console.warn(`[MediaImport] Failed to extract poster for ${file.path}:`, err);
                });
            } else if (type === "audio") {
              platform
                .extractAudioArtwork(file.path)
                .then((cover) => {
                  if (cover) {
                    useProjectStore.getState().updateMediaAsset(asset.id, { coverArt: cover });
                  }
                })
                .catch(() => {});
            }
          } catch (metadataError) {
            console.error(`[MediaImport] Failed to extract metadata for ${file.path}:`, metadataError);
            failedCount++;
          }
        } catch (fileError) {
          console.error(`[MediaImport] Failed to import ${file.path}:`, fileError);
          failedCount++;
        }
      });

      // Show appropriate toast notification
      if (failedCount > 0) {
        toast.warning(`${failedCount} file(s) failed to import.${importedCount > 0 ? ` ${importedCount} succeeded.` : ""}`);
      } else if (importedCount > 0 && skippedCount > 0) {
        toast.warning(`Imported ${importedCount} file(s). ${skippedCount} duplicate(s) skipped.`);
      } else if (skippedCount > 0) {
        toast.info(`${skippedCount} file(s) already imported.`);
      } else if (importedCount > 0) {
        toast.success(`Successfully imported ${importedCount} file(s).`);
      }
    } catch (error) {
      console.error("[MediaImport] Import failed:", error);
      toast.error("Failed to open file picker");
    } finally {
      setIsLoading(false);
    }
  };

  return {
    importMedia,
    isLoading,
    toastMessage: null,
    clearToast: () => {},
  };
};
