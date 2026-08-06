import React, { useRef, useState, useEffect } from "react";
import { TemplateDefinition } from "@/features/text-templates/types";
import { Star, Download, Plus } from "lucide-react";
import { TemplatePreviewPlayer, type TemplatePreviewPlayerHandle } from "@/features/text-templates";

interface TemplateCardProps {
  template: TemplateDefinition;
  isFavorite: boolean;
  isDownloading: boolean;
  isDownloaded?: boolean;
  loop?: boolean;
  onFavorite: (e: React.MouseEvent) => void;
  onApply: (e: React.MouseEvent) => void;
  onPreview: () => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  isFavorite,
  isDownloading,
  isDownloaded = false,
  loop = true,
  onFavorite,
  onApply,
  onPreview,
}) => {
  const lottieRef = useRef<TemplatePreviewPlayerHandle>(null);
  const [isHovered, setIsHovered] = useState(false);

  const resolvedThumbnailUrl =
    template.thumbnailUrl ||
    template.thumbnail ||
    `https://raw.githubusercontent.com/AIEraDev/clypra-api/main/data/thumbnails/${template.id}.png`;

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  // Play/pause the video preview based on hover state
  useEffect(() => {
    if (lottieRef.current) {
      if (isHovered) {
        lottieRef.current.goToFrame(0);
        lottieRef.current.play();
      } else {
        lottieRef.current.pause();
        lottieRef.current.goToFrame(template.thumbnailFrame || 0);
      }
    }
  }, [isHovered, template.thumbnailFrame]);

  return (
    <div
      onClick={onPreview}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="w-full aspect-square bg-surface-raised/40 hover:bg-surface-raised/80 border border-border/40 hover:border-accent/40 rounded-xl relative overflow-hidden flex flex-col justify-between p-1 transition-all duration-300 group cursor-pointer shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
    >
      {/* Downloading Overlay */}
      {isDownloading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-20 pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full border-3 border-accent border-t-transparent animate-spin" />
            <span className="text-[10px] font-semibold text-accent">Downloading...</span>
          </div>
        </div>
      )}

      {/* Favorite Star — top-right, appears on hover */}
      <button
        onClick={onFavorite}
        className={`absolute top-1 right-1 p-1 cursor-pointer rounded-full bg-surface/40 hover:bg-surface/60 border border-border/50 text-text-muted hover:text-text-primary transition-all duration-200 z-10 ${
          isFavorite
            ? "opacity-100 text-yellow-400!"
            : "opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2"
        }`}
      >
        <Star className={`w-3 h-3 ${isFavorite ? "fill-yellow-400 text-yellow-400!" : ""}`} />
      </button>

      {/* Preview area — thumbnail image and live webm video player (lazy-loaded) */}
      <div className="flex-1 flex items-center justify-center w-full select-none relative overflow-hidden transition-transform duration-500 ease-out group-hover:scale-[1.05]">
        {/* WebM Video Player (lazy-loaded while thumbnail is shown) */}
        <TemplatePreviewPlayer
          ref={lottieRef}
          lottieData={template}
          autoplay={false}
          loop={loop}
          mode="video"
          initialFrame={template.thumbnailFrame || 0}
          className={`w-full h-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)] select-none pointer-events-none transition-opacity duration-300 absolute inset-0 m-auto ${
            isHovered ? "opacity-100 z-10" : "opacity-0 z-0"
          }`}
        />

        {/* Static Thumbnail */}
        {resolvedThumbnailUrl ? (
          <img
            src={resolvedThumbnailUrl}
            alt={template.name}
            className={`max-w-full max-h-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)] select-none pointer-events-none transition-opacity duration-300 absolute inset-0 m-auto ${
              isHovered ? "opacity-0 z-0" : "opacity-100 z-10"
            }`}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div
            className={`flex flex-col items-center justify-center gap-1 text-text-muted transition-opacity duration-300 absolute inset-0 m-auto ${
              isHovered ? "opacity-0 z-0" : "opacity-100 z-10"
            }`}
          >
            <span className="text-2xl">📝</span>
            <span className="text-[9px] font-medium">{template.name}</span>
          </div>
        )}
      </div>

      {/* Footer — name + apply button, always visible like EffectCard */}
      <div className="flex items-center justify-between w-full mt-0.5 z-10">
        <span className="text-[9px] text-text-muted font-medium group-hover:text-text-primary transition-colors truncate max-w-[65px]">
          {template.name}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onApply(e);
          }}
          disabled={isDownloading}
          title={isDownloaded ? "Add template to timeline" : "Download template"}
          aria-label={isDownloaded ? "Add template to timeline" : "Download template"}
          className={`w-4 h-4 rounded-full flex items-center justify-center transition-all relative ${
            isDownloaded
              ? "bg-accent hover:bg-accent/85 border border-accent text-white cursor-pointer"
              : isDownloading
              ? "bg-accent/20 border border-accent cursor-wait"
              : "bg-surface/40 hover:bg-surface/60 border border-border/50 text-text-muted hover:text-text-primary cursor-pointer"
          }`}
        >
          {isDownloading ? (
            <div className="w-2 h-2 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          ) : isDownloaded ? (
            <Plus className="w-3 h-3 group-hover:scale-110 transition-transform" />
          ) : (
            <Download className="w-2 h-2 group-hover:scale-115 transition-transform" />
          )}
        </button>
      </div>
    </div>
  );
};
