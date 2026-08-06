import { useState, useCallback, useEffect } from "react";
import { Download, Star, Plus } from "lucide-react";
import { renderTextEffect } from "@/features/text-effects/renderer";
import type { TextEffectDefinition } from "@/features/text-effects/types/types";

interface EffectCardProps {
  effect: TextEffectDefinition;
  isFavorite: boolean;
  isDownloading: boolean;
  isDownloaded?: boolean;
  onFavorite: (e: React.MouseEvent) => void;
  onApply: (e: React.MouseEvent) => void;
  onPreview: () => void;
}

export const EffectCard: React.FC<EffectCardProps> = ({ effect, isFavorite, isDownloading, isDownloaded = false, onFavorite, onApply, onPreview }) => {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    setCanvas(node);
  }, []);

  const isTestOrCustom = !effect.id || effect.id.startsWith("effect-") || effect.id.startsWith("test-") || effect.id.startsWith("custom-") || effect.id.startsWith("user-");
  const thumbnailUrl = effect.thumbnailUrl || effect.thumbnail || (isTestOrCustom ? "" : `https://raw.githubusercontent.com/AIEraDev/clypra-api/main/data/thumbnails/${effect.id}.png`);

  useEffect(() => {
    // Only run canvas render if we don't have a static thumbnail url to draw
    if (canvas && !thumbnailUrl) {
      canvas.width = 250;
      canvas.height = 120;
      renderTextEffect(canvas, effect.text || "CLYPRA", effect, 34);

      if (typeof document !== "undefined" && document.fonts) {
        document.fonts.ready.then(() => {
          renderTextEffect(canvas, effect.text || "CLYPRA", effect, 34);
        });
      }
    }
  }, [canvas, effect, thumbnailUrl]);

  return (
    <div onClick={onPreview} className="w-full aspect-square bg-surface-raised/40 hover:bg-surface-raised/80 border border-border/40 hover:border-accent/40 rounded-xl relative overflow-hidden flex flex-col justify-between p-1 transition-all duration-300 group cursor-pointer shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
      {/* Downloading Overlay */}
      {isDownloading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-20 pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full border-3 border-accent border-t-transparent animate-spin" />
            <span className="text-[10px] font-semibold text-accent">Downloading...</span>
          </div>
        </div>
      )}

      {/* Favorite Star (hover show or active) */}
      <button onClick={onFavorite} className={`absolute top-1 right-1 p-1 cursor-pointer rounded-full bg-surface/40 hover:bg-surface/60 border border-border/50 text-text-muted hover:text-text-primary transition-all duration-200 z-10 ${isFavorite ? "opacity-100 text-yellow-400!" : "opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2"}`}>
        <Star className={`w-3 h-3 ${isFavorite ? "fill-yellow-400 text-yellow-400!" : ""}`} />
      </button>

      {/* Preview Content: Image Thumbnail or Canvas Fallback */}
      <div className="flex-1 flex items-center justify-center w-full select-none relative overflow-hidden transition-transform duration-500 ease-out group-hover:scale-[1.05]">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={effect.name}
            className="max-w-full max-h-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)] select-none pointer-events-none"
            onError={(e) => {
              // Fallback: hide image and let canvas render if error arises
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <canvas ref={canvasRef} className="max-w-full max-h-full block select-none pointer-events-none" />
        )}
      </div>

      {/* Footer Info / Apply Download Button */}
      <div className="flex items-center justify-between w-full mt-0.5 z-10">
        <span className="text-[9px] text-text-muted font-medium group-hover:text-text-primary transition-colors truncate max-w-[65px]">{effect.name}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onApply(e);
          }}
          disabled={isDownloading}
          title={isDownloaded ? "Add text to timeline" : "Download and add text to timeline"}
          aria-label={isDownloaded ? "Add text effect to timeline" : "Download and add text effect to timeline"}
          className={`w-4 h-4 rounded-full flex items-center justify-center transition-all relative ${isDownloaded ? "bg-accent hover:bg-accent/85 border border-accent text-white cursor-pointer" : isDownloading ? "bg-accent/20 border border-accent cursor-wait" : "bg-surface/40 hover:bg-surface/60 border border-border/50 text-text-muted hover:text-text-primary cursor-pointer"}`}
        >
          {isDownloading ? <div className="w-2 h-2 rounded-full border-2 border-accent border-t-transparent animate-spin" /> : isDownloaded ? <Plus className="w-3 h-3 group-hover:scale-110 transition-transform" /> : <Download className="w-2 h-2 group-hover:scale-115 transition-transform" />}
        </button>
      </div>
    </div>
  );
};
