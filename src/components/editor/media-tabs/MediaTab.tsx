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
  const { importMedia, isLoading } = useMediaImport();
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
            continue;
          }

          // Import new asset
          if (type === "video" || type === "audio") {
            const metadata: VideoMetadata = await invoke("get_video_metadata", { path: filePath });
            const posterFrame: string | undefined = type === "video" ? ((await invoke("extract_poster_frame", { path: filePath, time: 0.0 }).catch(() => undefined)) as string | undefined) : undefined;

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
            {
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
    <div ref={drag} onClick={handleClick} onContextMenu={onContextMenu} className={`group relative bg-surface-raised rounded overflow-hidden transition-all cursor-pointer ${isDragging ? "opacity-50" : ""} ${isSelected ? "ring-1 ring-accent" : ""}`}>
      <div className="aspect-video bg-surface-raised flex items-center justify-center relative">
        {asset.posterFrame ? <img src={asset.posterFrame} alt={asset.name} className="w-full h-full object-cover" /> : <div className="w-8 h-8">{asset.type === "video" ? <Film className="w-full h-full text-text-muted" /> : asset.type === "audio" ? <Music className="w-full h-full text-text-muted" /> : <Image className="w-full h-full text-text-muted" />}</div>}
        {asset.duration > 0 && (
          <div className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-xs text-white">
            {Math.floor(asset.duration / 60)}:{String(Math.floor(asset.duration % 60)).padStart(2, "0")}
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
