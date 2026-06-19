import React, { useState, useCallback, useMemo } from "react";
import { CloudUpload } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { useMediaImport } from "@/hooks/useMediaImport";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { useSettingsStore } from "@/store/settingsStore";
import { RippleDeleteCommand } from "@/core/history/commands/RippleDeleteCommand";
import { DeleteClipCommand } from "@/core/history/commands/DeleteClipCommand";
import type { VideoMetadata } from "@/core/platform";
import type { MediaTabProps } from "./types";
import { generateId } from "@/lib/utils/id";
import { SuccessToast } from "@/components/ui/SuccessToast";
import { MediaCard } from "@/components/ui/MediaCard";
import { platform } from "@/core/platform";

export const MediaTab: React.FC<MediaTabProps> = ({ onAddToTimeline }) => {
  const { mediaAssets, removeMediaAsset, addMediaAsset } = useProjectStore();
  const { importMedia, isLoading, toastMessage, clearToast } = useMediaImport();
  // Note: previewMediaId is used for visual selection state only.
  // Preview rendering is now timeline-driven, not media-selection driven.
  const { setPreviewMedia, previewMediaId } = useUIStore();
  const { clips } = useTimelineStore();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; mediaId: string } | null>(null);

  // Track which media assets are used in the timeline
  const usedMediaIds = useMemo(() => {
    return new Set(clips.map((clip) => clip.mediaId));
  }, [clips]);

  const getMediaType = (path: string): "video" | "audio" | "image" => {
    const lower = path.toLowerCase();
    if (/\.(mp4|mov|mkv|webm|flv)$/i.test(lower)) return "video";
    if (/\.(mp3|wav|aac|flac|m4a)$/i.test(lower)) return "audio";
    return "image";
  };

  const handleTauriFileDrop = useCallback(
    async (paths: string[]) => {
      for (const filePath of paths) {
        try {
          const filename = filePath.split("/").pop() || filePath.split("\\").pop() || "Unknown";
          const type = getMediaType(filename);

          // Check if asset already exists
          const existingAsset = mediaAssets.find((a) => a.path === filePath);
          if (existingAsset) {
            continue;
          }

          // Import new asset
          if (type === "video" || type === "audio") {
            const metadata: VideoMetadata = await platform.getMediaMetadata(filePath);
            // Use extract_poster_frame_command which extracts at 10% of duration (avoids black frames at 0s)
            const posterFrame: string | undefined = type === "video" ? await platform.extractPosterFrame(filePath, metadata.duration, window.devicePixelRatio || 1.0).catch(() => undefined) : undefined;

            const asset = {
              id: generateId("asset"),
              name: filename,
              path: filePath,
              type,
              duration: metadata.duration,
              width: metadata.width,
              height: metadata.height,
              posterFrame,
              size: (metadata as any).size ?? 0,
            };

            addMediaAsset(asset);
          } else {
            const asset = {
              id: generateId("asset"),
              name: filename,
              path: filePath,
              type: "image" as const,
              duration: 0,
              size: 0,
              posterFrame: platform.convertFileSrc(filePath),
            };

            addMediaAsset(asset);
          }
        } catch (error) {
          console.error(`[MediaTab] Failed to import ${filePath}:`, error);
          useProjectStore.getState().showToast(`Failed to import ${filePath.split("/").pop() || "file"}`, "error");
        }
      }
    },
    [mediaAssets, addMediaAsset],
  );

  // Use the file drop hook
  const { containerRef, isDraggingOver } = useFileDrop({
    onDrop: handleTauriFileDrop,
    enabled: true,
  });

  return (
    <div ref={containerRef} className={`flex-1 flex flex-col overflow-hidden transition-colors duration-200 ${isDraggingOver ? "bg-accent/5" : ""}`}>
      <div className="p-1 border-b border-border">
        <Button variant="secondary" size="sm" className="w-full border-dashed cursor-pointer" onClick={importMedia} disabled={isLoading}>
          <CloudUpload className="w-4 h-4" />
          {isLoading ? "Importing..." : "Import Media"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {mediaAssets.length === 0 ? (
          <EmptyState icon={CloudUpload} title="No media imported" description="Import videos, audio, or images to get started" />
        ) : (
          <div className="grid grid-cols-2 gap-2 p-1">
            {mediaAssets.map((asset) => (
              <MediaCard
                key={asset.id}
                asset={asset}
                isSelected={previewMediaId === asset.id}
                isUsedInTimeline={usedMediaIds.has(asset.id)}
                onClick={() => setPreviewMedia(asset.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, mediaId: asset.id });
                }}
                onAddToTimeline={() => onAddToTimeline?.(asset, "media")}
              />
            ))}
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          items={[
            usedMediaIds.has(contextMenu.mediaId)
              ? {
                  label: "Remove from Timeline",
                  onClick: () => {
                    const { normalizeTrack, removeEmptyNonMainTracks, withBatch } = useTimelineStore.getState();
                    const { execute, beginTransaction, commitTransaction } = useHistoryStore.getState();
                    const affectedTracks = new Set<string>();

                    // Find all clips using this media asset
                    const clipsToRemove = clips.filter((c) => c.mediaId === contextMenu.mediaId);

                    // Use transaction to group all deletes into a single undo/redo unit
                    beginTransaction("Remove from Timeline");

                    // Remove all clips using this asset
                    const { rippleEditEnabled } = useTimelineStore.getState();
                    clipsToRemove.forEach((clip) => {
                      affectedTracks.add(clip.trackId);
                      // Use ripple delete if ripple mode is enabled, otherwise regular delete
                      if (rippleEditEnabled) {
                        execute(new RippleDeleteCommand(clip.id));
                      } else {
                        execute(new DeleteClipCommand(clip.id));
                      }
                    });

                    commitTransaction();

                    // Remove empty tracks after deletion (not part of undo/redo)
                    withBatch(() => {
                      removeEmptyNonMainTracks(Array.from(affectedTracks));
                    });
                  },
                }
              : {
                  label: "Add to Track",
                  onClick: () => {
                    const asset = mediaAssets.find((a) => a.id === contextMenu.mediaId);
                    if (asset) onAddToTimeline?.(asset, "media");
                  },
                },
            { label: "Delete", onClick: () => removeMediaAsset(contextMenu.mediaId), danger: true },
          ]}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
        />
      )}

      <SuccessToast message={toastMessage?.message ?? null} variant={toastMessage?.type ?? "success"} onDismiss={clearToast} />
    </div>
  );
};
