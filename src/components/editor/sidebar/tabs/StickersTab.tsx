import React, { useState, useMemo, useEffect } from "react";
import { Smile, Loader2, AlertCircle, Plus, Download, Search, Info, WifiOff } from "lucide-react";
import { NetworkError } from "@/components/ui/NetworkError";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { useStickersStore } from "@/features/stickers/store/stickersStore";
import { useUIStore } from "@/store/uiStore";
import type { MediaAsset } from "@/types";
import type { TabProps } from "../types";
import {
  STICKER_CATEGORIES,
  StickersApi,
  type StickerCategory,
  type StickerItem,
} from "@/features/stickers/api/stickersApi";
import { platform } from "@/core/platform";

const ALL_CATEGORY = "all";

export const StickersTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORY);
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  // Initialize stickers cache and seed starters
  useEffect(() => {
    useStickersStore.getState().initializeCache();
  }, []);

  // Fetch stickers from API
  const fetchStickers = () => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIsNetworkError(false);

    const promise =
      activeCategory === ALL_CATEGORY
        ? StickersApi.getStickersIndex()
        : StickersApi.getStickersByCategory(activeCategory as StickerCategory);

    promise
      .then((nextStickers: StickerItem[]) => {
        if (!cancelled) {
          setStickers(nextStickers);
          setIsOfflineMode(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const errorMessage =
            err instanceof Error ? err.message : "Failed to load stickers";
          setError(errorMessage);
          const isNetwork =
            errorMessage.toLowerCase().includes("network") ||
            errorMessage.toLowerCase().includes("fetch") ||
            errorMessage.toLowerCase().includes("connection") ||
            errorMessage.toLowerCase().includes("offline");
          setIsNetworkError(isNetwork);

          // Fallback to offline starter stickers
          const fallback = StickersApi.getOfflineFallback(
            activeCategory === ALL_CATEGORY ? undefined : activeCategory,
          );
          if (fallback.length > 0) {
            setStickers(fallback);
            setIsOfflineMode(true);
            setError(null);
          }
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
    let filtered = stickers;

    if (activeCategory !== ALL_CATEGORY) {
      filtered = filtered.filter(
        (s) => s.category.toLowerCase() === activeCategory.toLowerCase(),
      );
    }

    if (query) {
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.tags?.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    return filtered;
  }, [stickers, searchQuery, activeCategory]);

  const formatCategoryName = (category: string) => {
    if (category === ALL_CATEGORY) return "All";
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search Input Bar */}
      <div className="p-1 border-b border-border/40">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search stickers & emojis..."
            className="w-full bg-surface-raised/40 border border-border/40 hover:border-border/80 focus:border-accent rounded-lg pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Category Pills */}
      <div
        className="flex gap-1 overflow-x-auto scrollbar-none border-b border-border/40 p-1 shrink-0"
        style={{ scrollbarWidth: "none" }}
      >
        <button
          key={ALL_CATEGORY}
          onClick={() => setActiveCategory(ALL_CATEGORY)}
          className={`shrink-0 cursor-pointer rounded px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-accent/10 hover:text-accent ${
            activeCategory === ALL_CATEGORY
              ? "bg-accent/15 text-accent"
              : "text-text-muted"
          }`}
        >
          All
        </button>
        {STICKER_CATEGORIES.map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`shrink-0 cursor-pointer rounded px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-accent/10 hover:text-accent ${
              activeCategory === category
                ? "bg-accent/15 text-accent"
                : "text-text-muted"
            }`}
          >
            {formatCategoryName(category)}
          </button>
        ))}
      </div>

      {/* Offline Mode Banner */}
      {isOfflineMode && (
        <div className="px-2 py-1 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-[10px] flex items-center gap-1.5 shrink-0">
          <WifiOff size={12} />
          <span>Offline mode: Ready-to-use starter stickers loaded.</span>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-1.5 space-y-2">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            <span>Loading sticker catalog...</span>
          </div>
        )}

        {!loading && error && isNetworkError && !isOfflineMode && (
          <NetworkError message="No internet connection." onRetry={fetchStickers} />
        )}

        {!loading && error && !isNetworkError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && filteredStickers.length === 0 && (
          <div className="rounded-lg border border-border bg-surface-raised/40 p-6 text-center">
            <Smile className="mx-auto mb-2 h-6 w-6 text-text-muted opacity-60" />
            <p className="text-xs font-semibold text-text-primary">
              No stickers found
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
              Try a different search query or select another category.
            </p>
          </div>
        )}

        {!loading && (!error || isOfflineMode) && filteredStickers.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {filteredStickers.map((sticker) => (
              <StickerCard
                key={sticker.id}
                sticker={sticker}
                onAddToTimeline={onAddToTimeline}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// StickerCard Component
const StickerCard: React.FC<{
  sticker: StickerItem;
  onAddToTimeline?: (item: any, type: any) => void;
}> = ({ sticker, onAddToTimeline }) => {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const { getDownloadState, startDownload, isDownloaded, getCachedSticker } =
    useStickersStore();
  const { previewAsset } = useUIStore();

  const downloadState = getDownloadState(sticker.id);
  const isDownloadedFlag = isDownloaded(sticker.id);
  const isDownloading = downloadState?.status === "downloading";

  const handlePreview = async () => {
    if (!isDownloadedFlag) {
      try {
        await startDownload(sticker);
      } catch (error) {
        console.error("[StickerCard] Download failed during preview:", error);
        return;
      }
    }

    try {
      const cached = getCachedSticker(sticker.id);
      if (!cached) return;

      const appCache = await platform.appCacheDir();
      const absoluteImagePath =
        cached.localImagePath && !cached.localImagePath.startsWith("data:")
          ? await platform.joinPaths(appCache, cached.localImagePath)
          : cached.localImagePath || "";
      const absoluteAnimationPath =
        cached.localAnimationPath && !cached.localAnimationPath.startsWith("bundled://")
          ? await platform.joinPaths(appCache, cached.localAnimationPath)
          : cached.localAnimationPath || "";

      const mediaAsset: MediaAsset = {
        id: `sticker-${sticker.id}`,
        name: sticker.name || "Sticker",
        path: absoluteImagePath,
        type: "image",
        duration: 3.0,
        size: cached.sizeBytes || 0,
        stickerFormat: "lottie",
        stickerAnimationPath: absoluteAnimationPath,
        stickerSourceId: sticker.id,
      };

      previewAsset(mediaAsset);
    } catch (error) {
      console.error("[StickerCard] Preview failed:", error);
    }
  };

  const handleAddToTimeline = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!isDownloadedFlag) {
      try {
        await startDownload(sticker);
      } catch (error) {
        console.error("[StickerCard] Add to timeline failed:", error);
        return;
      }
    }

    onAddToTimeline?.(sticker, "stickers");
  };

  return (
    <div
      onClick={handlePreview}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="w-full aspect-square bg-surface-raised/40 hover:bg-surface-raised/80 border border-border/40 hover:border-accent/40 rounded-xl relative overflow-hidden flex flex-col justify-between p-1 transition-all duration-200 group cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.2)]"
    >
      {/* Downloading Overlay */}
      {isDownloading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-20 pointer-events-none">
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <span className="text-[9px] font-semibold text-accent">
              {downloadState?.progress || 0}%
            </span>
          </div>
        </div>
      )}

      {/* Attribution / License Info Tooltip */}
      {sticker.license && (
        <div className="absolute top-1 left-1 z-10">
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={`p-0.5 rounded bg-black/60 backdrop-blur-sm text-[8px] font-mono text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity`}
              >
                <Info size={10} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-48 text-[10px]">
              <p className="font-semibold text-white">
                {sticker.license.spdx}
              </p>
              <p className="text-gray-300">{sticker.license.author}</p>
              {sticker.license.attributionText && (
                <p className="text-gray-400 mt-0.5 italic">
                  {sticker.license.attributionText}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Preview area */}
      <div className="flex-1 flex items-center justify-center w-full select-none relative overflow-hidden transition-transform duration-300 ease-out group-hover:scale-105">
        {!imageError ? (
          <img
            src={sticker.thumbnailUrl}
            alt={sticker.name}
            className="max-w-[85%] max-h-[85%] object-contain select-none pointer-events-none drop-shadow-md"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 text-text-muted">
            <span className="text-xl">✨</span>
            <span className="text-[8px] font-medium truncate max-w-[60px]">
              {sticker.name}
            </span>
          </div>
        )}
      </div>

      {/* Footer: name + add/download button */}
      <div className="flex items-center justify-between w-full mt-0.5 z-10 px-0.5">
        <span className="text-[9px] text-text-muted font-medium group-hover:text-text-primary transition-colors truncate max-w-[62px]">
          {sticker.name}
        </span>
        <button
          onClick={handleAddToTimeline}
          disabled={isDownloading}
          title={
            isDownloadedFlag ? "Add sticker to timeline" : "Download sticker"
          }
          aria-label={
            isDownloadedFlag ? "Add sticker to timeline" : "Download sticker"
          }
          className={`w-4 h-4 rounded-full flex items-center justify-center transition-all relative ${
            isDownloadedFlag
              ? "bg-accent hover:bg-accent/85 border border-accent text-white cursor-pointer"
              : isDownloading
                ? "bg-accent/20 border border-accent cursor-wait"
                : "bg-surface/50 hover:bg-surface/80 border border-border/50 text-text-muted hover:text-text-primary cursor-pointer"
          }`}
        >
          {isDownloading ? (
            <div className="w-2 h-2 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          ) : isDownloadedFlag ? (
            <Plus className="w-3 h-3 group-hover:scale-110 transition-transform" />
          ) : (
            <Download className="w-2.5 h-2.5 group-hover:scale-110 transition-transform" />
          )}
        </button>
      </div>
    </div>
  );
};
