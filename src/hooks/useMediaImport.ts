import { useState } from "react";
import { useProjectStore } from "../store/projectStore";
import type { MediaAsset } from "../types";
import { generateSimpleWaveform } from "../lib/audio/audioWaveformGenerator";
import { generateId } from "@/lib/utils/id";
import { platform } from "@/core/platform";
import { DEFAULT_STILL_DURATION_SECONDS } from "../constants/config";
import { t } from "@/i18n";

export const useMediaImport = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "warning"; message: string } | null>(null);
  const { addMediaAsset, mediaAssets } = useProjectStore();

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

      for (const file of selected) {
        try {
          // Check if asset already exists by path or filename (fallback)
          const existingAsset = mediaAssets.find((a) => a.path === file.path || a.name === file.name);
          if (existingAsset) {
            skippedCount++;
            continue;
          }

          const type = getMediaType(file.name);

          try {
            // Get metadata (duration, width, height) through platform adapter
            const metadata = await platform.getMediaMetadata(file.path);

            let posterFrame: string | undefined;
            let coverArt: string | undefined;

            if (type === "video") {
              posterFrame = await platform.extractPosterFrame(file.path, metadata.duration, window.devicePixelRatio || 1.0);
            } else if (type === "audio") {
              coverArt = await platform.extractAudioArtwork(file.path);
              posterFrame = generateSimpleWaveform({
                width: 160,
                height: 90,
                barCount: 32,
                barColor: "#22d3ee",
                backgroundColor: "#1e293b",
              });
            } else if (type === "image") {
              posterFrame = platform.convertFileSrc(file.path);
            }

            const asset: MediaAsset = {
              id: generateId("asset"),
              name: file.name,
              path: file.path,
              type,
              duration: type === "image" ? DEFAULT_STILL_DURATION_SECONDS : metadata.duration,
              width: type === "audio" ? 0 : metadata.width,
              height: type === "audio" ? 0 : metadata.height,
              posterFrame,
              coverArt,
              size: file.size || (metadata as any).size || 0,
            };

            addMediaAsset(asset);
            importedCount++;
          } catch (metadataError) {
            console.error(`[MediaImport] Failed to extract metadata for ${file.path}:`, metadataError);
            failedCount++;
            continue;
          }
        } catch (fileError) {
          console.error(`[MediaImport] Failed to import ${file.path}:`, fileError);
          failedCount++;
        }
      }

      // Show appropriate toast message
      if (failedCount > 0) {
        setToastMessage({
          type: "warning",
          message: importedCount > 0
            ? t("features.media.importSummary.failedWithSuccess", { failed: failedCount, imported: importedCount })
            : t("features.media.importSummary.failed", { failed: failedCount }),
        });
      } else if (importedCount > 0 && skippedCount > 0) {
        setToastMessage({
          type: "warning",
          message: t("features.media.importSummary.importedWithSkipped", { imported: importedCount, skipped: skippedCount }),
        });
      } else if (skippedCount > 0) {
        setToastMessage({
          type: "warning",
          message: t("features.media.importSummary.alreadyImported", { count: skippedCount }),
        });
      } else if (importedCount > 0) {
        setToastMessage({
          type: "success",
          message: t("features.media.importSummary.imported", { count: importedCount }),
        });
      }
    } catch (error) {
      console.error("[MediaImport] Import failed:", error);
      setToastMessage({ type: "warning", message: t("features.media.importPickerFailed") });
    } finally {
      setIsLoading(false);
    }
  };

  const getMediaType = (path: string): "video" | "audio" | "image" => {
    const lower = path.toLowerCase();
    if (/\.(mp4|mov|mkv|webm|m4v|flv)$/i.test(lower)) return "video";
    if (/\.(mp3|wav|aac|ogg|flac|m4a)$/i.test(lower)) return "audio";
    return "image";
  };

  return {
    importMedia,
    isLoading,
    toastMessage,
    clearToast: () => setToastMessage(null),
  };
};
