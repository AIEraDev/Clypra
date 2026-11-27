import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Info, Plus } from "lucide-react";
import { useTranslation } from "@/i18n";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { useClipDownloadStore } from "../store/clipDownloadStore";
import type { ClipItem } from "../types";

export interface ClipTileProps {
  clip: ClipItem;
  isHovered: boolean;
  onHoverStart: (clipId: string) => void;
  onHoverEnd: (clipId: string) => void;
  onAddToTimeline: (clip: ClipItem) => void;
}

export const ClipTile: React.FC<ClipTileProps> = ({
  clip,
  isHovered,
  onHoverStart,
  onHoverEnd,
  onAddToTimeline,
}) => {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [posterError, setPosterError] = useState(false);

  const downloadState = useClipDownloadStore((s) => s.downloads[clip.id]);
  const isDownloading = downloadState?.status === "downloading";
  const isError = downloadState?.status === "error";

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isHovered) {
      video.play()?.catch(() => {
        // Autoplay may be blocked in headless/test environments; ignore silently.
      });
    } else {
      video.pause();
    }
  }, [isHovered]);

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToTimeline(clip);
  };

  const formattedDuration = `${Math.max(1, Math.round(clip.durationSec))}s`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={clip.title}
      onClick={handleAdd}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAddToTimeline(clip);
        }
      }}
      onMouseEnter={() => onHoverStart(clip.id)}
      onMouseLeave={() => onHoverEnd(clip.id)}
      onFocus={() => onHoverStart(clip.id)}
      onBlur={() => onHoverEnd(clip.id)}
      className={`w-full aspect-video bg-surface-raised/40 hover:bg-surface-hover border rounded-lg relative overflow-hidden group cursor-pointer shadow-sm transition-all duration-150 ${
        isError
          ? "border-red-500/60"
          : "border-border/40 hover:border-accent/50"
      }`}
    >
      {/* Downloading Overlay */}
      {isDownloading && (
        <div
          data-testid="clip-downloading-overlay"
          className="absolute inset-0 bg-surface-workspace/80 backdrop-blur-[2px] flex items-center justify-center z-20 pointer-events-none"
        >
          <div className="flex flex-col items-center gap-1">
            <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <span className="text-[9px] font-semibold text-accent">
              {downloadState?.progress ?? 0}%
            </span>
          </div>
        </div>
      )}

      {/* Error Badge */}
      {isError && (
        <div
          data-testid="clip-error-indicator"
          title={downloadState?.error}
          className="absolute top-1 left-1 z-20 p-0.5 rounded bg-red-500/80 text-white"
        >
          <AlertCircle size={10} />
        </div>
      )}

      {/* License Info Tooltip (shown when not in error state) */}
      {!isError && (
        <div className="absolute top-1 left-1 z-10">
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                data-testid="clip-license-trigger"
                onClick={(e) => e.stopPropagation()}
                className="p-0.5 rounded bg-surface-floating/80 backdrop-blur-sm text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Info size={10} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-48 text-[10px]">
              <p className="font-semibold text-text-primary">
                {clip.license.spdx}
              </p>
              <p className="text-gray-300">{clip.license.author}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Add to timeline button */}
      <button
        type="button"
        onClick={handleAdd}
        aria-label={t("clips.addToTimeline")}
        title={t("clips.addToTimeline")}
        className="absolute top-1 right-1 z-10 w-5 h-5 rounded bg-surface-floating/85 hover:bg-accent text-text-primary hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      >
        <Plus size={12} />
      </button>

      {/* Media Preview: video when hovered, poster otherwise */}
      {isHovered ? (
        <video
          ref={videoRef}
          src={clip.previewUrl}
          poster={clip.posterUrl}
          muted
          autoPlay
          loop
          playsInline
          className="w-full h-full object-cover"
        />
      ) : !posterError ? (
        <img
          src={clip.posterUrl}
          alt={clip.title}
          loading="lazy"
          onError={() => setPosterError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-surface-raised text-[10px] text-text-muted px-1 text-center">
          {clip.title}
        </div>
      )}

      {/* Bottom duration & title overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-1.5 py-1 flex items-end justify-between gap-1 pointer-events-none">
        <span className="text-[10px] font-medium text-white truncate">
          {clip.title}
        </span>
        <span className="text-[9px] font-mono text-white/80 shrink-0">
          {formattedDuration}
        </span>
      </div>
    </div>
  );
};
