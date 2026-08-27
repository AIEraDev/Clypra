import React from "react";
import { platform } from "@/core/platform";
import { isWebviewOrExternalUrl } from "@/lib/platform/pathConversion";

// @ts-ignore - react-dnd types issue
import { useDrag } from "react-dnd";
import { Film, Plus } from "lucide-react";

import { useUIStore } from "@/store/uiStore";
import { formatTime } from "@/lib/utils/timeFormatting";
import { MediaCardWaveform } from "./MediaCardWaveform";

// MediaCard Component
interface MediaCardProps {
  asset: any;
  isSelected: boolean;
  isUsedInTimeline: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onAddToTimeline: () => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  asset,
  isSelected,
  isUsedInTimeline,
  onClick,
  onContextMenu,
  onAddToTimeline,
}) => {
  const { previewAsset } = useUIStore();

  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: "MEDIA_ASSET",
      // React DnD v16 invokes a function-valued item at drag start. The old
      // spec.begin callback was removed in v14 and throws before HTML5 drag
      // events can reach the timeline target.
      item: () => {
        return { type: "MEDIA_ASSET", asset };
      },
      end: (_item: any, _monitor: any) => {},
      collect: (monitor: any) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [asset],
  );

  const handleClick = () => {
    onClick(); // Keep selection state
    previewAsset(asset); // Switch to source preview + auto-pause program
  };

  return (
    <div
      ref={drag as unknown as React.Ref<HTMLDivElement>}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      className={`group relative bg-surface-raised rounded overflow-hidden transition-all cursor-pointer ${isDragging ? "opacity-50" : ""} ${isSelected ? "ring-1 ring-accent" : ""}`}
    >
      <div className="aspect-video bg-surface-raised flex items-center justify-center relative">
        {asset.type === "video" &&
        asset.posterFrame &&
        !/\.(mp4|mov|mkv|webm|flv)(%|$)/i.test(asset.posterFrame) ? (
          <img
            src={asset.posterFrame}
            alt={asset.name}
            className="w-full h-full object-contain"
          />
        ) : asset.type === "audio" ? (
          <MediaCardWaveform
            audioPath={asset.path}
            duration={asset.duration}
            className="w-full h-full"
          />
        ) : asset.type === "image" ? (
          <img
            src={
              isWebviewOrExternalUrl(asset.path)
                ? asset.path
                : platform.convertFileSrc(asset.path)
            }
            alt={asset.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-8 h-8">
            <Film className="w-full h-full text-text-muted" />
          </div>
        )}
        {asset.duration > 0 && (
          <div className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] text-white">
            {formatTime(asset.duration)}
          </div>
        )}
        {/* "Added" badge */}
        {isUsedInTimeline && (
          <div className="absolute top-1 left-1 bg-purple-950/80 px-1 py-px rounded-xs text-[8px] text-white flex items-center gap-1">
            <span>Added</span>
          </div>
        )}
      </div>
      <div className="px-1 py-0.5">
        <p className="text-[10px] font-medium text-text-primary truncate">
          {asset.name}
        </p>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onAddToTimeline();
        }}
        title="Add to Track"
        className="hidden cursor-pointer group-hover:flex bg-accent hover:bg-accent/90 w-5 h-5 rounded-full justify-center items-center absolute top-1 right-1 transition-colors"
      >
        <Plus size={14} className="text-white" />
      </button>
    </div>
  );
};
