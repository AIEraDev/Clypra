import React from "react";
import { platform } from "@/core/platform";
import { isWebviewOrExternalUrl } from "@/lib/platform/pathConversion";

// @ts-ignore - react-dnd types issue
import { useDrag } from "react-dnd";
import { Film, Plus, AlertTriangle } from "lucide-react";

import { useUIStore } from "@/store/uiStore";
import { useProjectStore } from "@/store/projectStore";
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

  // Self-heal: If video asset is missing a posterFrame, lazily extract it in background
  React.useEffect(() => {
    if (
      asset.type === "video" &&
      !asset.posterFrame &&
      !asset.isMissing &&
      asset.path
    ) {
      let isMounted = true;
      platform
        .extractPosterFrame(
          asset.path,
          asset.duration || 1.0,
          typeof window !== "undefined" ? window.devicePixelRatio || 1.0 : 1.0,
        )
        .then((posterFrame) => {
          if (isMounted && posterFrame) {
            useProjectStore
              .getState()
              .updateMediaAsset(asset.id, { posterFrame });
          }
        })
        .catch((err) => {
          console.warn(
            `[MediaCard] Failed to lazy extract poster for ${asset.name}:`,
            err,
          );
        });
      return () => {
        isMounted = false;
      };
    }
  }, [
    asset.id,
    asset.type,
    asset.posterFrame,
    asset.isMissing,
    asset.path,
    asset.duration,
  ]);

  const isImage =
    asset.type === "image" ||
    /\.(jpg|jpeg|png|gif|webp|bmp|svg|tiff|heic|heif|avif)$/i.test(
      asset.name || asset.path || "",
    );

  return (
    <div
      ref={drag as unknown as React.Ref<HTMLDivElement>}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      className={`group relative bg-surface-elevated border border-border-default/60 hover:border-border-strong rounded-lg shadow-xs overflow-hidden transition-all cursor-pointer ${isDragging ? "opacity-50" : ""} ${isSelected ? "ring-1 ring-accent" : ""} ${asset.isMissing ? "ring-1 ring-red-500/60" : ""}`}
    >
      <div className="aspect-video bg-surface-elevated flex items-center justify-center relative">
        {isImage ? (
          <img
            src={
              asset.posterFrame ||
              (isWebviewOrExternalUrl(asset.path)
                ? asset.path
                : platform.convertFileSrc(asset.path))
            }
            alt={asset.name}
            className="w-full h-full object-contain"
          />
        ) : asset.type === "video" &&
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
        ) : (
          <div className="w-8 h-8">
            <Film className="w-full h-full text-text-muted" />
          </div>
        )}
        {!isImage && asset.duration > 0 && (
          <div className="absolute bottom-1 right-1 bg-surface-floating/90 border border-border-default px-1.5 py-0.5 rounded text-[10px] text-text-primary font-mono shadow-xs">
            {formatTime(asset.duration)}
          </div>
        )}
        {/* "Added" badge */}
        {isUsedInTimeline && (
          <div className="absolute top-1 left-1 bg-accent-primary/80 px-1 py-px rounded-xs text-[8px] text-white flex items-center gap-1">
            <span>Added</span>
          </div>
        )}
        {/* "Offline" badge */}
        {asset.isMissing && (
          <div
            data-testid="media-offline-badge"
            className="absolute top-1 right-1 bg-red-600/90 text-white px-1.5 py-0.5 rounded text-[8px] font-bold flex items-center gap-1 shadow-sm z-10"
            title="File is missing or moved"
          >
            <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
            <span>OFFLINE</span>
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
        className="hidden cursor-pointer group-hover:flex bg-accent-primary hover:bg-accent-primary/90 w-5 h-5 rounded-full justify-center items-center absolute top-1 right-1 transition-colors"
      >
        <Plus size={14} className="text-white" />
      </button>
    </div>
  );
};
