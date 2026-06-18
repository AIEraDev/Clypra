/**
 * Renderer Effects Browser
 *
 * Browse and apply renderer-based effects from @clypra/engine
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Download, Play, Plus, Search, Loader2, AlertCircle, Smile, Star } from "lucide-react";
import { VideoEffectsApi } from "../api/videoEffectsApi";
import { type EffectMetadata } from "@clypra/engine";
import type { EffectRenderer as EffectRendererType } from "@clypra/engine";
import type { TabType } from "@/components/editor/media-tabs/types";
import { useFavoritesStore } from "@/store/favoritesStore";

interface RendererEffectsBrowserProps {
  onEffectSelect?: (effectId: EffectRendererType) => void;
  onAddToTimeline?: (item: any, type: TabType) => void;
  showApplyButton?: boolean;
}

const VIDEO_EFFECT_CATEGORIES = [
  { id: "essentials", name: "Essentials" },
  { id: "glitch", name: "Glitch" },
  { id: "retro", name: "Retro" },
  { id: "light", name: "Light" },
  { id: "motion", name: "Motion" },
  { id: "color", name: "Color" },
];

export function RendererEffectsBrowser({ onEffectSelect, onAddToTimeline, showApplyButton = true }: RendererEffectsBrowserProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("essentials");
  const [effects, setEffects] = useState<EffectMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [downloadingPreviews, setDownloadingPreviews] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const { favorites, downloadedEffects, downloadingIds, toggleFavorite, startDownload, completeDownload } = useFavoritesStore();

  // Load effects when category changes
  useEffect(() => {
    if (selectedCategory) {
      loadEffects();
    }
  }, [selectedCategory]);

  const loadEffects = async () => {
    setLoading(true);
    try {
      // Load effects from API by category
      const categoryEffects = await VideoEffectsApi.getRendererEffectsByCategory(selectedCategory);

      // Convert API format to EffectMetadata format
      const metadata: EffectMetadata[] = categoryEffects.map((effect: any) => ({
        id: effect.renderer,
        name: effect.name,
        category: effect.category,
        description: effect.description,
        defaultParams: effect.params,
        parameterSchema: effect.parameterSchema,
        tags: effect.tags,
        premium: effect.isPremium,
      }));

      setEffects(metadata);
    } catch (error) {
      console.error("Failed to load effects:", error);
      // Fallback to local registry if API fails
      try {
        const { getEffectsByCategory } = await import("@clypra/engine");
        const categoryEffects = getEffectsByCategory(selectedCategory as any);
        setEffects(categoryEffects);
      } catch (fallbackError) {
        console.error("Failed to load from local registry:", fallbackError);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPreview = async (effectId: string) => {
    if (previewUrls[effectId] || downloadingPreviews.has(effectId)) {
      return;
    }

    setDownloadingPreviews((prev) => new Set(prev).add(effectId));

    try {
      const url = await VideoEffectsApi.getEffectPreviewObjectURL(effectId, selectedCategory);
      setPreviewUrls((prev) => ({ ...prev, [effectId]: url }));
    } catch (error) {
      console.error(`Failed to download preview for ${effectId}:`, error);
    } finally {
      setDownloadingPreviews((prev) => {
        const next = new Set(prev);
        next.delete(effectId);
        return next;
      });
    }
  };

  const handleApplyEffect = (effectId: EffectRendererType) => {
    const effect = effects.find((e) => e.id === effectId);
    if (onAddToTimeline && effect) {
      onAddToTimeline(
        {
          id: effect.id,
          name: effect.name,
          renderer: effect.id,
          params: effect.defaultParams || {},
        },
        "video-effects"
      );
    }

    if (onEffectSelect) {
      onEffectSelect(effectId);
    }
  };

  const handleDownloadAndApply = async (effect: any) => {
    const itemId = effect.id;
    if (downloadingIds.includes(itemId)) return;

    if (downloadedEffects.includes(itemId)) {
      handleApplyEffect(itemId as EffectRendererType);
      return;
    }

    startDownload(itemId);
    setTimeout(() => {
      completeDownload(itemId, "effect");
      handleApplyEffect(itemId as EffectRendererType);
    }, 650);
  };

  const filteredEffects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return effects;
    return effects.filter(
      (effect) =>
        effect.name.toLowerCase().includes(query) ||
        (effect.description && effect.description.toLowerCase().includes(query)) ||
        (effect.tags && effect.tags.some((tag) => tag.toLowerCase().includes(query)))
    );
  }, [effects, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Category Pills */}
      <div className="flex gap-1 overflow-x-auto scrollbar-none border-b border-border p-1 shrink-0" style={{ scrollbarWidth: "none" }}>
        {VIDEO_EFFECT_CATEGORIES.map((cat) => (
          <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] font-semibold transition-colors flex items-center ${selectedCategory === cat.id ? "bg-accent text-white" : "text-text-muted hover:bg-surface-raised hover:text-text-primary"}`}>
            <span>{cat.name}</span>
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="p-1 border-b border-border shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" placeholder="Search video effects..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-raised border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      {/* Effects Grid */}
      <div className="flex-1 overflow-y-auto p-1.5 scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading effects...
          </div>
        ) : filteredEffects.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface-raised/40 p-4 text-center">
            <Smile className="mx-auto mb-2 h-5 w-5 text-text-muted" />
            <p className="text-xs font-semibold text-text-primary">No effects found</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Try a different search or category</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {filteredEffects.map((effect) => (
              <EffectCard
                key={effect.id}
                effect={effect}
                previewUrl={previewUrls[effect.id]}
                isFavorite={favorites.includes(effect.id)}
                isDownloaded={downloadedEffects.includes(effect.id)}
                isDownloading={downloadingIds.includes(effect.id)}
                onFavorite={(e) => {
                  e.stopPropagation();
                  toggleFavorite(effect.id);
                }}
                onDownloadPreview={() => handleDownloadPreview(effect.id)}
                onApply={(e) => {
                  e.stopPropagation();
                  handleDownloadAndApply(effect);
                }}
                showApplyButton={showApplyButton}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface EffectCardProps {
  effect: EffectMetadata;
  previewUrl?: string;
  isFavorite: boolean;
  isDownloaded: boolean;
  isDownloading: boolean;
  onFavorite: (e: React.MouseEvent) => void;
  onDownloadPreview: () => void;
  onApply: (e: React.MouseEvent) => void;
  showApplyButton: boolean;
}

function EffectCard({
  effect,
  previewUrl,
  isFavorite,
  isDownloaded,
  isDownloading,
  onFavorite,
  onDownloadPreview,
  onApply,
  showApplyButton,
}: EffectCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      if (isHovered && previewUrl) {
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    }
  }, [isHovered, previewUrl]);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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

      {/* Favorite Star (hover show or active) */}
      <button
        onClick={onFavorite}
        className={`absolute top-1 right-1 p-1 cursor-pointer rounded-full bg-surface/40 hover:bg-surface/60 border border-border/50 text-text-muted hover:text-text-primary transition-all duration-200 z-10 ${
          isFavorite ? "opacity-100 text-yellow-400!" : "opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2"
        }`}
      >
        <Star className={`w-3 h-3 ${isFavorite ? "fill-yellow-400 text-yellow-400!" : ""}`} />
      </button>

      {/* Preview Content: Video on hover, or Category Emoji */}
      <div className="flex-1 flex items-center justify-center w-full select-none relative overflow-hidden rounded-lg">
        {previewUrl ? (
          <video
            ref={videoRef}
            src={previewUrl}
            loop
            muted
            playsInline
            className="w-full h-full object-cover rounded-lg"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full w-full bg-linear-to-br from-accent/10 to-accent/0 text-center rounded-lg p-2">
            <span className="text-4xl filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)] group-hover:scale-[1.05] transition-transform duration-300">
              {getCategoryIcon(effect.category)}
            </span>
          </div>
        )}

        {/* Hover overlay if not downloaded yet */}
        {!previewUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownloadPreview();
              }}
              className="p-1.5 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 text-white transition-colors"
              title="Download animated preview"
            >
              <Download size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Footer Info / Apply Button */}
      <div className="flex items-center justify-between w-full mt-0.5 z-10 px-0.5">
        <span className="text-[9px] text-text-muted font-medium group-hover:text-text-primary transition-colors truncate max-w-[65px]" title={effect.name}>
          {effect.name}
        </span>
        {showApplyButton && (
          <button
            onClick={onApply}
            disabled={isDownloading}
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
        )}
      </div>
    </div>
  );
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    camera: "🎥",
    light: "💡",
    blur: "🌫️",
    style: "🎨",
    distortion: "🌀",
    time: "⏱️",
    body: "🧍",
    essentials: "✨",
    glitch: "📺",
    retro: "📼",
    motion: "🌀",
    color: "🎨",
  };
  return icons[category.toLowerCase()] || icons[category] || "✨";
}

