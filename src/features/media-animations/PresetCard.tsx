import React, { useCallback, useRef, useState } from "react";
import {
  Star,
  Sparkles,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  CloudDownload,
  Loader2,
  Check,
} from "lucide-react";
import { useI18n } from "@/i18n";

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Sparkles,
};

interface PresetCardProps {
  name: string;
  icon: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  isSelected: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
  // New download props:
  isDownloaded: boolean;
  isDownloading: boolean;
  onDownload: (e: React.MouseEvent) => void;
}

const PresetCard: React.FC<PresetCardProps> = ({
  name,
  icon,
  thumbnailUrl,
  previewUrl,
  isSelected,
  isFavorite,
  onSelect,
  onToggleFavorite,
  isDownloaded,
  isDownloading,
  onDownload,
}) => {
  const { t } = useI18n();
  const [isHovered, setIsHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const IconComp = ICON_MAP[icon] ?? Sparkles;

  const handlePointerEnter = useCallback(() => {
    setIsHovered(true);
    if (previewUrl && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {
        // Autoplay blocked by browser policy — thumbnail stays visible.
      });
    }
  }, [previewUrl]);

  const handlePointerLeave = useCallback(() => {
    setIsHovered(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      onSelect();
      if (!isDownloaded) {
        onDownload(e);
      }
    },
    [isDownloaded, onSelect, onDownload],
  );

  // Show the video layer only while hovered AND a previewUrl exists.
  const showVideo = isHovered && Boolean(previewUrl);
  // Show the thumbnail when not showing the video and a thumbnailUrl exists.
  const showThumb = !showVideo && Boolean(thumbnailUrl);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick(e as unknown as React.MouseEvent);
        }
      }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      aria-label={
        isDownloaded
          ? t("properties.mediaAnimation.selectAnimation")
          : t("properties.mediaAnimation.downloadAnimation")
      }
      className="flex flex-col items-center group cursor-pointer text-left relative"
    >
      <div
        className={`w-full h-16 rounded-md flex flex-col items-center justify-center transition-all relative overflow-hidden ${
          isSelected ? "border border-accent/30" : "bg-accent/10"
        }`}
      >
        {/* Thumbnail — visible when not hovered (or no preview available) */}
        {showThumb && (
          <img
            src={thumbnailUrl}
            alt={name}
            className="absolute inset-0 w-full h-full object-contain"
            draggable={false}
          />
        )}

        {/* Preview video — always in the DOM when previewUrl exists so the
            browser can buffer; visibility controlled via opacity only so we
            never remount the element on every hover. */}
        {previewUrl && (
          <video
            ref={videoRef}
            src={previewUrl}
            muted
            playsInline
            loop
            preload="none"
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-100 ${
              showVideo ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden="true"
          />
        )}

        {/* Fallback — shown only when neither thumbnail nor preview exists */}
        {!thumbnailUrl && !previewUrl && (
          <>
            <span className="text-[9px] font-bold text-white/60 tracking-tight">
              ABC
            </span>
            <IconComp
              className={`w-4 h-4 mt-0.5 ${isSelected ? "text-[#00E5FF]" : "text-text-muted group-hover:text-text-primary"}`}
            />
          </>
        )}

        {/* Favorite star */}
        <button
          type="button"
          onClick={onToggleFavorite}
          className={`absolute top-0.5 right-0.5 p-0.5 rounded transition-all z-10 cursor-pointer ${
            isFavorite
              ? "opacity-100 text-amber-400"
              : "opacity-0 group-hover:opacity-60 text-text-muted hover:text-amber-400"
          }`}
        >
          <Star
            className={`w-2.5 h-2.5 ${isFavorite ? "fill-amber-400" : ""}`}
          />
        </button>

        {/* Download / downloading / downloaded indicator — bottom-left */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!isDownloaded && !isDownloading) onDownload(e);
          }}
          className={`absolute bottom-0.5 left-0.5 p-0.5 rounded transition-all z-10 cursor-pointer ${
            isDownloaded
              ? "opacity-40 text-green-400"
              : isDownloading
                ? "opacity-100 text-white"
                : "opacity-0 group-hover:opacity-60 text-text-muted hover:text-white"
          }`}
          aria-label={
            isDownloaded
              ? t("properties.mediaAnimation.downloaded")
              : isDownloading
                ? t("properties.mediaAnimation.downloading")
                : t("properties.mediaAnimation.downloadAnimation")
          }
        >
          {isDownloading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : isDownloaded ? (
            <Check className="w-3 h-3" />
          ) : (
            <CloudDownload className="w-3 h-3" />
          )}
        </button>
      </div>
      <span
        title={name}
        className="text-[10px] font-medium text-text-muted mt-1 truncate max-w-full group-hover:text-text-primary text-center"
      >
        {name}
      </span>
    </div>
  );
};

export default PresetCard;
