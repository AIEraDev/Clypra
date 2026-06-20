import React, { useState, useMemo, useEffect } from "react";
import { Smile, Loader2, Sparkles, AlertCircle, Plus, Download } from "lucide-react";
import { NetworkError } from "@/components/ui/NetworkError";
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
          <button key={category} onClick={() => setActiveCategory(category)} className={`shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-accent/10 hover:text-accent ${activeCategory === category ? "bg-accent/10 text-accent" : "text-text-muted"}`}>
            {formatCategoryName(category)}
          </button>
        ))}
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

// StickerCard Component - Lottie-only with .webm preview on hover
const StickerCard: React.FC<{ sticker: StickerItem; onAddToTimeline?: (item: any, type: any) => void }> = ({ sticker, onAddToTimeline }) => {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [lottieData, setLottieData] = useState<any>(null);

  const { getDownloadState, startDownload, isDownloaded, getCachedSticker } = useStickersStore();
  const { previewAsset } = useUIStore();

  const downloadState = getDownloadState(sticker.id);
  const isDownloadedFlag = isDownloaded(sticker.id);
  const cachedSticker = getCachedSticker(sticker.id);

  const isDownloading = downloadState?.status === "downloading";

  // Load Lottie JSON data if sticker is cached
  useEffect(() => {
    if (cachedSticker && cachedSticker.lottieData) {
      setLottieData(cachedSticker.lottieData);
    }
  }, [cachedSticker]);

  const handlePreview = async () => {
    // Download full Lottie JSON if not already cached
    if (!isDownloadedFlag) {
      try {
        await startDownload(sticker);
      } catch (error) {
        console.error("[StickerCard] Download failed during preview:", error);
        return;
      }
    }

    // Now show preview with the cached file
    try {
      const cached = getCachedSticker(sticker.id);
      if (!cached) {
        throw new Error("Cached sticker not found after download");
      }

      const appCache = await import("@tauri-apps/api/path").then((m) => m.appCacheDir());
      const absolutePath = await import("@tauri-apps/api/path").then((m) => m.join(appCache, cached.localAnimationPath));

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

    // Ensure sticker is downloaded before adding to timeline
    if (!isDownloadedFlag) {
      try {
        await startDownload(sticker);
      } catch (error) {
        console.error("[StickerCard] Add to timeline failed:", error);
        return;
      }
    }

    // Now add to timeline with cached data
    onAddToTimeline?.(sticker, "stickers");
  };

  return (
    <div onClick={handlePreview} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} className="w-full aspect-square bg-surface-raised/40 hover:bg-surface-raised/80 border border-border/40 hover:border-accent/40 rounded-xl relative overflow-hidden flex flex-col justify-between p-1 transition-all duration-300 group cursor-pointer shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
      {/* Downloading Overlay - Same as TemplateCard */}
      {isDownloading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-20 pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full border-3 border-accent border-t-transparent animate-spin" />
            <span className="text-[10px] font-semibold text-accent">{downloadState?.progress || 0}%</span>
          </div>
        </div>
      )}

      {/* Premium Badge - top-left, appears on hover like favorite star */}
      {sticker.isPremium && (
        <button className={`absolute top-1 left-1 p-1 rounded-full bg-surface/40 hover:bg-surface/60 border border-border/50 transition-all duration-200 z-10 ${isHovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}>
          <Sparkles className="w-3 h-3 text-purple-400" />
        </button>
      )}

      {/* Preview area - with hover scale animation like TemplateCard */}
      <div className="flex-1 flex items-center justify-center w-full select-none relative overflow-hidden transition-transform duration-500 ease-out group-hover:scale-[1.05]">
        {/* Video Preview (shown on hover) - plays .webm without downloading Lottie JSON */}
        <video src={sticker.preview} autoPlay={isHovered} loop muted playsInline className={`max-w-full max-h-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)] select-none pointer-events-none transition-opacity duration-300 absolute inset-0 m-auto ${isHovered ? "opacity-100 z-10" : "opacity-0 z-0"}`} />

        {/* Static Thumbnail */}
        {!imageError ? (
          <img src={sticker.thumbnailUrl} alt={sticker.name} className={`max-w-full max-h-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)] select-none pointer-events-none transition-opacity duration-300 absolute inset-0 m-auto ${isHovered ? "opacity-0 z-0" : "opacity-100 z-10"}`} onError={() => setImageError(true)} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 text-text-muted">
            <span className="text-2xl">🎨</span>
            <span className="text-[9px] font-medium">{sticker.name}</span>
          </div>
        )}
      </div>

      {/* Footer - name + apply button, always visible like TemplateCard */}
      <div className="flex items-center justify-between w-full mt-0.5 z-10">
        <span className="text-[9px] text-text-muted font-medium group-hover:text-text-primary transition-colors truncate max-w-[65px]">{sticker.name}</span>
        <button onClick={handleAddToTimeline} disabled={isDownloading} title={isDownloadedFlag ? "Add sticker to timeline" : "Download sticker"} aria-label={isDownloadedFlag ? "Add sticker to timeline" : "Download sticker"} className={`w-4 h-4 rounded-full flex items-center justify-center transition-all relative ${isDownloadedFlag ? "bg-accent hover:bg-accent/85 border border-accent text-white cursor-pointer" : isDownloading ? "bg-accent/20 border border-accent cursor-wait" : "bg-surface/40 hover:bg-surface/60 border border-border/50 text-text-muted hover:text-text-primary cursor-pointer"}`}>
          {isDownloading ? <div className="w-2 h-2 rounded-full border-2 border-accent border-t-transparent animate-spin" /> : isDownloadedFlag ? <Plus className="w-3 h-3 group-hover:scale-110 transition-transform" /> : <Download className="w-2 h-2 group-hover:scale-115 transition-transform" />}
        </button>
      </div>
    </div>
  );
};
