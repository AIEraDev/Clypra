import React, { useState, useEffect, useMemo } from "react";
import { Search, Sparkles, AlertCircle, Star, Download, Plus } from "lucide-react";
import type { EffectPreset } from "../types";
import { VideoEffectsApi } from "../api/videoEffectsApi";
import { useFavoritesStore } from "@/store/favoritesStore";

interface EffectPickerProps {
  onSelect: (effect: EffectPreset) => void;
}

const BODY_EFFECT_CATEGORIES = [
  { id: "trending", name: "Trending" },
  { id: "motion", name: "Motion" },
  { id: "aura", name: "Aura" },
  { id: "wings", name: "Wings" },
  { id: "energy", name: "Energy" },
  { id: "fun", name: "Fun" },
];

export function EffectPicker({ onSelect }: EffectPickerProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("aura"); // Default to "aura" since that's where the default effects are
  const [searchQuery, setSearchQuery] = useState("");
  const [effects, setEffects] = useState<EffectPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { favorites, downloadedEffects, downloadingIds, toggleFavorite, startDownload, completeDownload } = useFavoritesStore();

  useEffect(() => {
    loadBodyEffects();
  }, []);

  const loadBodyEffects = async () => {
    setLoading(true);
    setError(null);
    try {
      const bodyEffects = await VideoEffectsApi.getBodyEffects();
      setEffects(bodyEffects);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load body effects";
      setError(message);
      console.error("Failed to load body effects:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyEffect = (effect: EffectPreset) => {
    onSelect(effect);
  };

  const handleDownloadAndApply = async (effect: EffectPreset) => {
    const itemId = effect.id;
    if (downloadingIds.includes(itemId)) return;

    if (downloadedEffects.includes(itemId)) {
      handleApplyEffect(effect);
      return;
    }

    startDownload(itemId);
    setTimeout(() => {
      completeDownload(itemId, "effect");
      handleApplyEffect(effect);
    }, 650);
  };

  const filteredEffects = useMemo(() => {
    let filtered = effects;

    if (selectedCategory) {
      filtered = filtered.filter((e: EffectPreset) => {
        const cat = e.category?.toLowerCase() === "body" ? "aura" : e.category?.toLowerCase();
        return cat === selectedCategory;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e: EffectPreset) =>
          e.name.toLowerCase().includes(query) ||
          e.description.toLowerCase().includes(query) ||
          e.tags?.some((t) => t.toLowerCase().includes(query))
      );
    }

    return filtered;
  }, [effects, selectedCategory, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Category Pills */}
      <div className="flex gap-1 overflow-x-auto scrollbar-none border-b border-border p-1 shrink-0" style={{ scrollbarWidth: "none" }}>
        {BODY_EFFECT_CATEGORIES.map((cat) => (
          <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] font-semibold transition-colors flex items-center ${selectedCategory === cat.id ? "bg-accent text-white" : "text-text-muted hover:bg-surface-raised hover:text-text-primary"}`}>
            <span>{cat.name}</span>
          </button>
        ))}
      </div>

      {/* Search Input */}
      <div className="p-1 border-b border-border shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search body effects..." className="w-full bg-surface-raised border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      {/* Grid Content */}
      <div className="flex-1 overflow-y-auto p-1.5 scrollbar-thin">
        {loading && (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-accent border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && filteredEffects.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-1 text-xs text-text-muted">
            <p>No matching effects found</p>
            <p className="opacity-60">Try another search or category</p>
          </div>
        )}

        {!loading && !error && filteredEffects.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {filteredEffects.map((effect) => (
              <EffectCard
                key={effect.id}
                effect={effect}
                isFavorite={favorites.includes(effect.id)}
                isDownloaded={downloadedEffects.includes(effect.id)}
                isDownloading={downloadingIds.includes(effect.id)}
                onFavorite={(e) => {
                  e.stopPropagation();
                  toggleFavorite(effect.id);
                }}
                onApply={(e) => {
                  e.stopPropagation();
                  handleDownloadAndApply(effect);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface EffectCardProps {
  effect: EffectPreset;
  isFavorite: boolean;
  isDownloaded: boolean;
  isDownloading: boolean;
  onFavorite: (e: React.MouseEvent) => void;
  onApply: (e: React.MouseEvent) => void;
}

function EffectCard({
  effect,
  isFavorite,
  isDownloaded,
  isDownloading,
  onFavorite,
  onApply,
}: EffectCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onClick={onApply}
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

      {/* Premium badge */}
      {effect.isPremium && (
        <div className="absolute top-1 left-1 z-10 pointer-events-none">
          <div className="bg-linear-to-r from-purple-500 to-pink-500 rounded-full p-0.5">
            <Sparkles className="w-2.5 h-2.5 text-white" />
          </div>
        </div>
      )}

      {/* Favorite Star */}
      <button
        onClick={onFavorite}
        className={`absolute top-1 right-1 p-1 cursor-pointer rounded-full bg-surface/40 hover:bg-surface/60 border border-border/50 text-text-muted hover:text-text-primary transition-all duration-200 z-10 ${
          isFavorite ? "opacity-100 text-yellow-400!" : "opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2"
        }`}
      >
        <Star className={`w-3 h-3 ${isFavorite ? "fill-yellow-400 text-yellow-400!" : ""}`} />
      </button>

      {/* Thumbnail or Category fallback */}
      <div className="flex-1 flex items-center justify-center w-full select-none relative overflow-hidden rounded-lg bg-surface">
        {effect.thumbnail ? (
          <img src={effect.thumbnail} alt={effect.name} className="w-full h-full object-cover rounded-lg" />
        ) : (
          <div className="flex flex-col items-center justify-center h-full w-full bg-linear-to-br from-accent/10 to-accent/0 text-center rounded-lg p-2">
            <span className="text-4xl filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)] group-hover:scale-[1.05] transition-transform duration-300">
              {getCategoryIcon(effect.category || "aura")}
            </span>
          </div>
        )}
      </div>

      {/* Footer Title / Apply Button */}
      <div className="flex items-center justify-between w-full mt-0.5 z-10 px-0.5">
        <span className="text-[9px] text-text-muted font-medium group-hover:text-text-primary transition-colors truncate max-w-[65px]" title={effect.name}>
          {effect.name}
        </span>
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
      </div>
    </div>
  );
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    trending: "🔥",
    motion: "🌀",
    aura: "✨",
    wings: "🪽",
    energy: "⚡",
    fun: "🎉",
  };
  return icons[category.toLowerCase()] || icons[category] || "✨";
}
