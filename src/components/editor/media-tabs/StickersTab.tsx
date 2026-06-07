import React, { useState, useMemo, useEffect } from "react";
import { Search, Smile, Download, Loader2, Sparkles, AlertCircle } from "lucide-react";
import type { TabProps } from "./types";
import { STICKER_CATEGORIES, ClypraStickersApi, type StickerCategory, type StickerItem } from "@/features/stickers/api/clypraStickersApi";

export const StickersTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<StickerCategory>("trending");
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch stickers from API by category
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    ClypraStickersApi.getStickersByCategory(activeCategory)
      .then((nextStickers) => {
        if (!cancelled) setStickers(nextStickers);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load stickers");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeCategory]);

  const filteredStickers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let filtered = stickers.filter((s) => s.category === activeCategory);

    // Filter by search
    if (query) {
      filtered = filtered.filter((s) => s.name.toLowerCase().includes(query) || s.tags?.some((tag) => tag.toLowerCase().includes(query)));
    }

    return filtered;
  }, [stickers, searchQuery, activeCategory]);

  // Format category name for display
  const formatCategoryName = (category: string) => {
    // Special formatting for specific categories
    const specialFormats: Record<string, string> = {
      y2k: "Y2K",
      "free-fire": "Free Fire 🔥",
      football: "Football⚽",
      new: "NEW",
      letters: "LETTERS",
      sfx: "SFX",
      ui: "UI",
    };

    if (specialFormats[category]) {
      return specialFormats[category];
    }

    return category
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  return (
    <>
      {/* Category Pills - Same as AudioTab */}
      <div className="flex gap-1 overflow-x-auto scrollbar-none border-b border-border p-1" style={{ scrollbarWidth: "none" }}>
        {STICKER_CATEGORIES.map((category) => (
          <button key={category} onClick={() => setActiveCategory(category)} className={`shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] font-semibold transition-colors ${activeCategory === category ? "bg-accent text-white" : "text-text-muted hover:bg-surface-raised hover:text-text-primary"}`}>
            {formatCategoryName(category)}
          </button>
        ))}
      </div>

      {/* Search Bar - Same as AudioTab */}
      <div className="p-1 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" placeholder="Search stickers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-raised border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      {/* Content Area - Same pattern as AudioTab */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-1 space-y-2">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading stickers...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && filteredStickers.length === 0 && (
          <div className="rounded-lg border border-border bg-surface-raised/40 p-4 text-center">
            <Smile className="mx-auto mb-2 h-5 w-5 text-text-muted" />
            <p className="text-xs font-semibold text-text-primary">No stickers found</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Try a different search or category</p>
          </div>
        )}

        {!loading && !error && filteredStickers.length > 0 && (
          <div className="grid grid-cols-3 gap-2 p-2">
            {filteredStickers.map((sticker) => (
              <StickerCard key={sticker.id} sticker={sticker} onAddToTimeline={() => onAddToTimeline?.(sticker, "stickers")} />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

// StickerCard Component - Following AudioItem pattern with animation support
const StickerCard: React.FC<{ sticker: StickerItem; onAddToTimeline: () => void }> = ({ sticker, onAddToTimeline }) => {
  const [imageError, setImageError] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);

  // Use animated version on hover if available
  const displayUrl = showAnimation && sticker.animatedUrl ? sticker.animatedUrl : sticker.thumbnailUrl;

  return (
    <div className="group relative aspect-square bg-surface-raised hover:bg-surface-raised/60 rounded-lg overflow-hidden transition-all border border-border hover:border-accent/30 cursor-pointer" onClick={onAddToTimeline} onMouseEnter={() => setShowAnimation(true)} onMouseLeave={() => setShowAnimation(false)}>
      {/* Animation Badge */}
      {sticker.isAnimated && (
        <div className="absolute top-2 right-2 z-10">
          <div className="bg-blue-500 rounded-full px-1.5 py-0.5">
            <span className="text-[10px] text-white font-semibold">{sticker.format === "lottie" ? "ANIM" : sticker.format === "gif" ? "GIF" : "ANIM"}</span>
          </div>
        </div>
      )}

      {/* Premium Badge - Same position as download indicator in AudioTab */}
      {sticker.isPremium && (
        <div className="absolute top-2 left-2 z-10">
          <div className="bg-linear-to-r from-purple-500 to-pink-500 rounded-full p-1">
            <Sparkles className="w-3 h-3 text-white" />
          </div>
        </div>
      )}

      {/* Image or Fallback */}
      {displayUrl && !imageError ? (
        <img src={displayUrl} alt={sticker.name} className="w-full h-full object-contain p-3" onError={() => setImageError(true)} />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-5xl">
          {/* Fallback emoji based on name */}
          {sticker.name.includes("Heart") ? "❤️" : sticker.name.includes("Star") ? "⭐" : sticker.name.includes("Circle") ? "⭕" : "🎨"}
        </div>
      )}

      {/* Download Icon on Hover - Same as AudioTab's plus icon */}
      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="bg-accent rounded-full p-1.5">
          <Download className="w-4 h-4 text-white" />
        </div>
      </div>

      {/* Hover Overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none" />
    </div>
  );
};
