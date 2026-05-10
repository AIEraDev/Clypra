import React, { useState, useCallback, useMemo } from "react";
import { CloudUpload, Music, Film, Image, Plus, Check } from "lucide-react";
// @ts-ignore - react-dnd types issue
import { useDrag } from "react-dnd";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ContextMenu } from "../../ui/ContextMenu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { useMediaImport } from "../../../hooks/useMediaImport";
import { useFileDrop } from "../../../hooks/useFileDrop";
import { useProjectStore } from "../../../store/projectStore";
import { useUIStore } from "../../../store/uiStore";
import { useTimelineStore } from "../../../store/timelineStore";
import type { VideoMetadata } from "../../../types";
import type { MediaTabProps } from "./types";

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
    if (/\.(mp4|mov|avi|mkv|webm|flv)$/i.test(lower)) return "video";
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
            console.log(`[MediaTab] Asset already imported, skipping: ${filePath}`);
            continue;
          }

          // Import new asset
          if (type === "video" || type === "audio") {
            const metadata: VideoMetadata = await invoke("get_video_metadata", { path: filePath });
            // Use extract_poster_frame_command which extracts at 10% of duration (avoids black frames at 0s)
            const posterFrame: string | undefined = type === "video" ? ((await invoke("extract_poster_frame_command", { videoPath: filePath, duration: metadata.duration, dpr: window.devicePixelRatio || 1.0 }).catch(() => undefined)) as string | undefined) : undefined;

            const asset = {
              id: `asset-${Date.now()}-${Math.random()}`,
              name: filename,
              path: filePath,
              type,
              duration: metadata.duration,
              width: metadata.width,
              height: metadata.height,
              posterFrame,
              size: metadata.size,
            };

            addMediaAsset(asset);
          } else {
            const asset = {
              id: `asset-${Date.now()}-${Math.random()}`,
              name: filename,
              path: filePath,
              type: "image" as const,
              duration: 0,
              size: 0,
              posterFrame: convertFileSrc(filePath),
            };

            addMediaAsset(asset);
          }
        } catch (error) {
          console.error(`[MediaTab] Failed to import ${filePath}:`, error);
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
    <div ref={containerRef} className={`flex-1 flex flex-col overflow-hidden transition-colors ${isDraggingOver ? "bg-surface-raised/10 transition-colors duration-300" : ""}`}>
      <div className="p-3 border-b border-border">
        <Button variant="secondary" size="sm" className="w-full border-dashed" onClick={importMedia} disabled={isLoading}>
          <CloudUpload className="w-4 h-4" />
          {isLoading ? "Importing..." : "Import Media"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {mediaAssets.length === 0 ? (
          <EmptyState icon={CloudUpload} title="No media imported" description="Import videos, audio, or images to get started" />
        ) : (
          <div className="grid grid-cols-2 gap-2 p-3">
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
                    const { removeClip, normalizeTrack } = useTimelineStore.getState();
                    const affectedTracks = new Set<string>();

                    // Find all clips using this media asset
                    const clipsToRemove = clips.filter((c) => c.mediaId === contextMenu.mediaId);

                    // Note: Main track protection removed - users can remove any clips
                    // Timeline validation will inform about gaps, but never blocks removal

                    console.log("[MediaTab] 🗑️ Removing clips from timeline", {
                      mediaId: contextMenu.mediaId,
                      clipCount: clipsToRemove.length,
                    });

                    // Remove all clips using this asset
                    clipsToRemove.forEach((clip) => {
                      affectedTracks.add(clip.trackId);
                      removeClip(clip.id);
                    });

                    // Normalize affected tracks to close gaps
                    affectedTracks.forEach((trackId) => normalizeTrack(trackId));
                  },
                }
              : {
                  label: "Add to Timeline",
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

      {/* Toast notifications */}
      {toastMessage && (
        <div className={`fixed bottom-4 right-4 z-50 max-w-md rounded-lg shadow-lg transition-all duration-300 ${toastMessage.type === "warning" ? "bg-gradient-to-br from-yellow-500 to-orange-500" : "bg-gradient-to-br from-green-500 to-emerald-600"}`} role="alert">
          <div className="flex items-start gap-3 p-4">
            <div className="shrink-0 mt-0.5">
              {toastMessage.type === "warning" ? (
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">{toastMessage.type === "warning" ? "Warning" : "Success"}</p>
              <p className="mt-1 text-sm text-white/90">{toastMessage.message}</p>
            </div>
            <button onClick={clearToast} className="shrink-0 ml-2 text-white/80 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// MediaCard Component
interface MediaCardProps {
  asset: any;
  isSelected: boolean;
  isUsedInTimeline: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onAddToTimeline: () => void;
}

const MediaCard: React.FC<MediaCardProps> = ({ asset, isSelected, isUsedInTimeline, onClick, onContextMenu, onAddToTimeline }) => {
  const { previewAsset } = useUIStore();

  const [{ isDragging }, drag] = useDrag(() => ({
    type: "MEDIA_ASSET",
    item: { type: "MEDIA_ASSET", asset },
    collect: (monitor: any) => ({
      isDragging: monitor.isDragging(),
    }),
  }));

  const handleClick = () => {
    onClick(); // Keep selection state
    previewAsset(asset); // Switch to source preview
  };

  return (
    <div ref={drag as unknown as React.Ref<HTMLDivElement>} onClick={handleClick} onContextMenu={onContextMenu} className={`group relative bg-surface-raised rounded overflow-hidden transition-all cursor-pointer ${isDragging ? "opacity-50" : ""} ${isSelected ? "ring-1 ring-accent" : ""}`}>
      <div className="aspect-video bg-surface-raised flex items-center justify-center relative">
        {asset.posterFrame && !/\.(mp4|mov|avi|mkv|webm|flv)(%|$)/i.test(asset.posterFrame) ? <img src={asset.posterFrame} alt={asset.name} className="w-full h-full object-contain" /> : <div className="w-8 h-8">{asset.type === "video" ? <Film className="w-full h-full text-text-muted" /> : asset.type === "audio" ? <Music className="w-full h-full text-text-muted" /> : <Image className="w-full h-full text-text-muted" />}</div>}
        {asset.duration > 0 && (
          <div className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-xs text-white">
            {Math.floor(Math.ceil(asset.duration) / 60)}:{String(Math.ceil(asset.duration) % 60).padStart(2, "0")}
          </div>
        )}
        {/* "Added" badge */}
        {isUsedInTimeline && (
          <div className="absolute top-1 left-1 bg-purple-950/80 px-1 py-px rounded-[2px] text-[8px] text-white flex items-center gap-1">
            <span>Added</span>
          </div>
        )}
      </div>
      <div className="px-1 py-0.5">
        <p className="text-[10px] font-medium text-text-primary truncate">{asset.name}</p>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddToTimeline();
            }}
            className="hidden group-hover:flex bg-accent hover:bg-accent/90 w-5 h-5 rounded-full justify-center items-center absolute top-1 right-1 transition-colors"
          >
            <Plus size={14} className="text-white" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Add to Timeline</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
};
