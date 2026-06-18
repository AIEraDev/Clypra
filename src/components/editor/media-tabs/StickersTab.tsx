import React, { useState, useMemo, useEffect } from "react";
import { Search, Smile, Download, Loader2, Sparkles, AlertCircle, CheckCircle, Plus } from "lucide-react";
import { NetworkError } from "@/components/ui/NetworkError";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { useStickersStore } from "@/features/stickers/store/stickersStore";
import { useUIStore } from "@/store/uiStore";
import type { MediaAsset } from "@/types";
import type { TabProps } from "./types";
import { STICKER_CATEGORIES, StickersApi, type StickerCategory, type StickerItem } from "@/features/stickers/api/stickersApi";

export const StickersTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<StickerCategory>("emoji");
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);

  // Initialize stickers cache
  useEffect(() => {
    useStickersStore.getState().initializeCache();
  }, []);

  // Fetch stickers from API by category
  const fetchStickers = () => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIsNetworkError(false);

    StickersApi.getStickersByCategory(activeCategory)
      .then((nextStickers: StickerItem[]) => {
        if (!cancelled) setStickers(nextStickers);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const errorMessage = err instanceof Error ? err.message : "Failed to load stickers";
          setError(errorMessage);
          // Detect network errors
          const isNetwork = errorMessage.toLowerCase().includes("network") || errorMessage.toLowerCase().includes("fetch") || errorMessage.toLowerCase().includes("connection") || errorMessage.toLowerCase().includes("offline");
          setIsNetworkError(isNetwork);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    const cleanup = fetchStickers();
    return cleanup;
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

        {!loading && error && isNetworkError && <NetworkError message="No internet connection." onRetry={fetchStickers} />}

        {!loading && error && !isNetworkError && (
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
          <div className="grid grid-cols-3 gap-1.5">
            {filteredStickers.map((sticker) => (
              <StickerCard key={sticker.id} sticker={sticker} onAddToTimeline={onAddToTimeline} />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

// StickerCard Component - Following AudioItem pattern with animation support
const StickerCard: React.FC<{ sticker: StickerItem; onAddToTimeline?: (item: any, type: any) => void }> = ({ sticker, onAddToTimeline }) => {
  const [imageError, setImageError] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);

  const { getDownloadState, startDownload, isDownloaded } = useStickersStore();
  const { previewAsset } = useUIStore();

  const downloadState = getDownloadState(sticker.id);
  const isDownloadedFlag = isDownloaded(sticker.id);

  const isDownloading = downloadState?.status === "downloading";

  // Use animated version on hover if available
  const displayUrl = showAnimation && sticker.animatedUrl ? sticker.animatedUrl : sticker.thumbnailUrl;

  const handlePreview = async () => {
    try {
      const cachedFile = await startDownload(sticker);
      const appCache = await import("@tauri-apps/api/path").then((m) => m.appCacheDir());

      const targetPath = cachedFile.format === "lottie" ? cachedFile.localAnimationPath : cachedFile.format === "gif" ? cachedFile.localAnimationPath : cachedFile.localImagePath;

      if (!targetPath) {
        throw new Error("Missing cached file path");
      }

      const absolutePath = await import("@tauri-apps/api/path").then((m) => m.join(appCache, targetPath));

      const mediaAsset: MediaAsset = {
        id: `sticker-${sticker.id}`,
        name: sticker.name || "Sticker",
        path: absolutePath,
        type: "image",
        duration: 0,
        size: 0,
      };

      previewAsset(mediaAsset);
    } catch (error) {
      console.error("[StickerCard] Preview failed:", error);
    }
  };

  const handleAddToTimeline = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await startDownload(sticker);
      onAddToTimeline?.(sticker, "stickers");
    } catch (error) {
      console.error("[StickerCard] Add to timeline failed:", error);
    }
  };

  return (
    <div className="group relative aspect-square bg-surface-raised hover:bg-surface-raised/60 rounded-lg overflow-hidden transition-all border border-border hover:border-accent/30 cursor-pointer" onClick={handlePreview} onMouseEnter={() => setShowAnimation(true)} onMouseLeave={() => setShowAnimation(false)}>
      {/* Premium Badge */}
      {sticker.isPremium && (
        <div className="absolute top-2 left-2 z-10">
          <div className="bg-linear-to-r from-purple-500 to-pink-500 rounded-full p-1">
            <Sparkles className="w-3 h-3 text-white" />
          </div>
        </div>
      )}

      {/* Cached Indicator */}
      {isDownloadedFlag && !isDownloading && (
        <div className="absolute top-2 right-2 z-10">
          <div className="bg-green-500 rounded-full p-0.5 shadow-md">
            <CheckCircle className="w-3 h-3 text-white" />
          </div>
        </div>
      )}

      {/* Downloading Overlay */}
      {isDownloading && (
        <div className="absolute inset-0 bg-black/60 z-10 flex flex-col items-center justify-center gap-1">
          <Loader2 className="w-5 h-5 text-accent animate-spin" />
          <span className="text-[10px] text-accent font-semibold">{downloadState?.progress || 0}%</span>
        </div>
      )}

      {/* Image or Fallback */}
      {displayUrl && !imageError ? <img src={displayUrl} alt={sticker.name} className="w-full h-full object-contain p-3" onError={() => setImageError(true)} /> : <div className="w-full h-full flex items-center justify-center text-5xl">{sticker.name.includes("Heart") ? "❤️" : sticker.name.includes("Star") ? "⭐" : sticker.name.includes("Circle") ? "⭕" : "🎨"}</div>}

      {/* Add to Timeline Button on Hover */}
      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={handleAddToTimeline} disabled={isDownloading} className="bg-accent hover:bg-accent/80 cursor-pointer rounded-full p-1.5 shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Plus className="w-4 h-4 text-white" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{isDownloadedFlag ? "Add to Timeline" : "Download & Add"}</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Hover Overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none" />
    </div>
  );
};
