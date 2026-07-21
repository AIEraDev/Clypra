import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle, Download, Loader2, Music2, Pause, Play, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { NetworkError } from "@/components/ui/NetworkError";
import { AUDIO_LIBRARY_CATEGORIES, AUDIO_LIBRARY_CATEGORY_LABEL_KEYS, AudioLibraryApi, type AudioLibraryCategory, type AudioLibraryItem } from "@/features/audio-library/api/audioLibraryApi";
import { useAudioLibraryStore } from "@/features/audio-library/store/audioLibraryStore";
import { useUIStore } from "@/store/uiStore";
import type { TabProps } from "./types";
import type { MediaAsset } from "@/types";
import { platform } from "@/core/platform";
import { t } from "@/i18n";

export const AudioTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<AudioLibraryCategory>("music");
  const [items, setItems] = useState<AudioLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);

  const fetchAudio = () => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIsNetworkError(false);

    AudioLibraryApi.getAudioByCategory(activeCategory)
      .then((nextItems: AudioLibraryItem[]) => {
        if (!cancelled) setItems(nextItems);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          setError(errorMessage);
          setIsNetworkError(err instanceof TypeError);
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
    const cleanup = fetchAudio();
    return cleanup;
  }, [activeCategory]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.name.toLowerCase().includes(query) || item.author.toLowerCase().includes(query) || item.tags?.some((tag) => tag.toLowerCase().includes(query)));
  }, [items, searchQuery]);

  return (
    <>
      <div className="flex gap-1 overflow-x-auto scrollbar-none border-b border-border p-1" style={{ scrollbarWidth: "none" }}>
        {AUDIO_LIBRARY_CATEGORIES.map((category) => (
          <button key={category} onClick={() => setActiveCategory(category)} className={`shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] font-semibold capitalize transition-colors ${activeCategory === category ? "bg-accent text-white" : "text-text-muted hover:bg-surface-raised hover:text-text-primary"}`}>
            {t(AUDIO_LIBRARY_CATEGORY_LABEL_KEYS[category])}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-1 space-y-2">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("features.audio.loading")}
          </div>
        )}

        {!loading && error && isNetworkError && <NetworkError onRetry={fetchAudio} />}

        {!loading && error && !isNetworkError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{t("features.audio.loadFailed", { error })}</span>
          </div>
        )}

        {!loading && !error && filteredItems.length === 0 && (
          <div className="rounded-lg border border-border bg-surface-raised/40 p-4 text-center">
            <Music2 className="mx-auto mb-2 h-5 w-5 text-text-muted" />
            <p className="text-xs font-semibold text-text-primary">{t("features.audio.emptyTitle")}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{t("features.audio.emptyDescription")}</p>
          </div>
        )}

        {!loading && !error && filteredItems.map((item) => <AudioItem key={item.id} item={item} onAddToTimeline={onAddToTimeline} />)}
      </div>
    </>
  );
};

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
};

interface AudioItemProps {
  item: AudioLibraryItem;
  onAddToTimeline?: (item: any, type: any) => void;
}

const AudioItem: React.FC<AudioItemProps> = ({ item, onAddToTimeline }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageError, setImageError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { getDownloadState, startDownload, isDownloaded } = useAudioLibraryStore();
  const { previewAsset } = useUIStore();
  // Note: addMediaAsset removed from here - only used when adding to timeline
  const downloadState = getDownloadState(item.id);
  const isDownloadedFlag = isDownloaded(item.id);

  // Handle inline play (stream from URL)
  const handleInlinePlay = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering preview
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    audio.currentTime = 0;
    void audio
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  };

  // Handle preview (download first, then open SourcePreview)
  const handlePreview = async () => {
    try {
      // Download if not already cached
      const cachedFile = await startDownload(item);

      // Convert relative cache path to absolute path for the webview
      // cachedFile.localPath is relative to AppCache (e.g., "audio-library/filename.wav")
      const appCache = await platform.appCacheDir();
      const absolutePath = await platform.joinPaths(appCache, cachedFile.localPath);

      // Create MediaAsset from cached file
      const mediaAsset: MediaAsset = {
        id: `audio-library-${item.id}`,
        name: item.name || t("editor.fallback.libraryAudio"),
        path: absolutePath, // Use absolute path for media playback
        type: "audio",
        duration: cachedFile.metadata.duration || item.duration,
        size: cachedFile.size,
        coverArt: item.coverArtUrl,
      };

      // NOTE: Preview does NOT add to project store - only adding to timeline does that
      // Open in SourcePreview
      previewAsset(mediaAsset);
    } catch (error) {
      console.error("[AudioItem] Preview failed:", error);
    }
  };

  // Handle add to timeline (download first, then add)
  const handleAddToTimeline = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering preview
    try {
      await startDownload(item);
      // Call parent handler with item
      onAddToTimeline?.(item, "audio");
    } catch (error) {
      console.error("[AudioItem] Add to timeline failed:", error);
    }
  };

  const isDownloading = downloadState?.status === "downloading";
  const displayName = item.name || t("editor.fallback.libraryAudio");
  const playLabel = t(isPlaying ? "features.audio.pause" : "features.audio.play", { name: displayName });
  const addLabel = t(isDownloadedFlag ? "features.audio.addToTimeline" : "features.audio.downloadAndAdd");

  return (
    <div onClick={handlePreview} className="group flex items-center gap-3 p-1 bg-surface-raised/40 hover:bg-surface-raised/60 rounded-lg transition-colors cursor-pointer">
      {/* Hidden audio element for inline streaming */}
      <audio ref={audioRef} src={item.audioUrl} preload="none" onEnded={() => setIsPlaying(false)} onPause={() => setIsPlaying(false)} className="hidden" />

      {/* Cover Art with Play Overlay */}
      <button onClick={handleInlinePlay} disabled={isDownloading} aria-label={playLabel} title={playLabel} className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 bg-surface-raised border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed group/cover">
        {item.coverArtUrl && !imageError ? (
          <img src={item.coverArtUrl} alt={displayName} className="w-full h-full object-cover" onError={() => setImageError(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-accent/20 to-accent/10">
            <img src="/clypra.svg" alt="Clypra" className="w-8 h-8 object-contain opacity-60" />
          </div>
        )}
        {/* Play/Pause Overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover/cover:bg-black/60 transition-colors flex items-center justify-center">{isPlaying ? <Pause className="w-5 h-5 text-white opacity-0 group-hover/cover:opacity-100 transition-opacity" /> : <Play className="w-5 h-5 text-white opacity-0 group-hover/cover:opacity-100 transition-opacity" />}</div>
        {/* Download Progress Indicator */}
        {isDownloading && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <Download className="w-4 h-4 text-accent animate-pulse" />
          </div>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium text-text-primary truncate mb-0.5">{displayName}</h4>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="truncate">{item.author}</span>
          <span>•</span>
          <span className="shrink-0">{formatDuration(item.duration)}</span>
        </div>
        {/* Status Indicators */}
        {(isDownloadedFlag || downloadState) && (
          <div className="flex items-center gap-1.5 mt-1">
            {isDownloadedFlag && !isDownloading && (
              <span className="flex items-center gap-1 text-[10px] text-green-400/80">
                <CheckCircle className="w-3 h-3" />
                {t("download.cached")}
              </span>
            )}
            {isDownloading && (
              <span className="flex items-center gap-1 text-[10px] text-accent">
                <Download className="w-3 h-3" />
                {downloadState.progress}%
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={handleAddToTimeline} disabled={isDownloading} aria-label={addLabel} className="w-9 h-9 flex items-center justify-center hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {isDownloading ? <Download className="w-4 h-4 text-accent animate-pulse" /> : <Plus className="w-4 h-4 text-text-primary" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{addLabel}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
