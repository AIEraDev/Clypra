import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Film, Loader2, Search, WifiOff } from "lucide-react";
import { NetworkError } from "@/components/ui/NetworkError";
import { SubTabPills, type SubTabPillItem } from "@/components/editor/sidebar/SubTabPills";
import { useTranslation } from "@/i18n";
import { ClipsApi } from "../api/clipsApi";
import {
  ALL_CLIP_CATEGORY,
  useClipUiStore,
  type ClipCategoryFilter,
} from "../store/clipUiStore";
import { addClipToTimeline } from "../actions/addClipToTimeline";
import { CLIP_CATEGORIES, type ClipItem } from "../types";
import type { TabType } from "@/components/editor/sidebar/types";
import { ClipTile } from "./ClipTile";

export interface ClipsTabProps {
  onAddToTimeline?: (item: ClipItem, type: TabType) => void;
}

const GRID_COLUMNS = 3;
const ESTIMATED_ROW_HEIGHT_PX = 96;
const OVERSCAN_ROWS = 2;

export const ClipsTab: React.FC<ClipsTabProps> = ({ onAddToTimeline }) => {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const {
    activeCategory,
    searchQuery,
    hoveredClipId,
    setActiveCategory,
    setSearchQuery,
    setHoveredClipId,
  } = useClipUiStore();

  const [clips, setClips] = useState<ClipItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const fetchClips = useCallback(async () => {
    setLoading(true);
    setError(null);
    setIsOffline(false);

    try {
      const items =
        activeCategory === ALL_CLIP_CATEGORY
          ? await ClipsApi.getClipsIndex()
          : await ClipsApi.getClipsByCategory(activeCategory);

      if (items.length === 0 && typeof navigator !== "undefined" && navigator.onLine === false) {
        setIsOffline(true);
      }
      setClips(items);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : tRef.current("clips.error.title");
      const offline =
        (typeof navigator !== "undefined" && navigator.onLine === false) ||
        message.toLowerCase().includes("network") ||
        message.toLowerCase().includes("fetch") ||
        message.toLowerCase().includes("offline");
      setIsOffline(offline);
      setError(message);
      setClips(ClipsApi.getOfflineFallback());
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => {
    void fetchClips();
  }, [fetchClips]);

  // Track viewport height for lightweight grid virtualization
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const updateHeight = () => {
      setViewportHeight(el.clientHeight);
    };
    updateHeight();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const categoryPills: SubTabPillItem<ClipCategoryFilter>[] = useMemo(
    () => [
      { value: ALL_CLIP_CATEGORY, label: t("clips.category.all") },
      ...CLIP_CATEGORIES.map((category) => ({
        value: category,
        label: t(`clips.category.${category}`),
      })),
    ],
    [t],
  );

  const filteredClips = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let list = clips;

    if (activeCategory !== ALL_CLIP_CATEGORY) {
      list = list.filter((c) => c.category === activeCategory);
    }

    if (query) {
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          c.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    return list;
  }, [clips, activeCategory, searchQuery]);

  // Virtualized row windowing (falls back to all rows when viewportHeight === 0, e.g. in jsdom)
  const totalRows = Math.ceil(filteredClips.length / GRID_COLUMNS);
  const { startRow, endRow } = useMemo(() => {
    if (viewportHeight <= 0 || totalRows === 0) {
      return { startRow: 0, endRow: Math.max(0, totalRows - 1) };
    }
    const first = Math.max(
      0,
      Math.floor(scrollTop / ESTIMATED_ROW_HEIGHT_PX) - OVERSCAN_ROWS,
    );
    const last = Math.min(
      totalRows - 1,
      Math.ceil((scrollTop + viewportHeight) / ESTIMATED_ROW_HEIGHT_PX) +
        OVERSCAN_ROWS,
    );
    return { startRow: first, endRow: last };
  }, [viewportHeight, totalRows, scrollTop]);

  const visibleClips = useMemo(() => {
    if (filteredClips.length === 0) return [];
    const startIdx = startRow * GRID_COLUMNS;
    const endIdx = (endRow + 1) * GRID_COLUMNS;
    return filteredClips.slice(startIdx, endIdx);
  }, [filteredClips, startRow, endRow]);

  const topSpacerPx = startRow * ESTIMATED_ROW_HEIGHT_PX;
  const bottomSpacerPx = Math.max(
    0,
    (totalRows - 1 - endRow) * ESTIMATED_ROW_HEIGHT_PX,
  );

  const handleAdd = useCallback(
    (clip: ClipItem) => {
      if (onAddToTimeline) {
        onAddToTimeline(clip, "clips");
      } else {
        void addClipToTimeline(clip);
      }
    },
    [onAddToTimeline],
  );

  const handleHoverStart = useCallback(
    (clipId: string) => {
      setHoveredClipId(clipId);
    },
    [setHoveredClipId],
  );

  const handleHoverEnd = useCallback(
    (clipId: string) => {
      if (useClipUiStore.getState().hoveredClipId === clipId) {
        setHoveredClipId(null);
      }
    },
    [setHoveredClipId],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Category Sub-Tab Pills */}
      <div className="flex items-center gap-2 p-1.5 border-b border-border/50 shrink-0 bg-surface/10">
        <SubTabPills
          items={categoryPills}
          value={activeCategory}
          onChange={setActiveCategory}
          ariaLabel={t("sidebar.tabs.clips")}
        />
      </div>

      {/* Search Bar */}
      <div className="p-1.5 border-b border-border/40 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("clips.search")}
            aria-label={t("clips.search")}
            className="w-full bg-surface-raised/40 border border-border/40 hover:border-border/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-text-primary focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Offline Banner when cached/empty */}
      {isOffline && clips.length > 0 && (
        <div className="px-2 py-1 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-[10px] flex items-center gap-1.5 shrink-0">
          <WifiOff size={12} />
          <span>{t("clips.offline")}</span>
        </div>
      )}

      {/* Virtualized Grid Content */}
      <div
        ref={scrollContainerRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="flex-1 overflow-y-auto scrollbar-thin p-1.5"
      >
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            <span>{t("clips.loading")}</span>
          </div>
        )}

        {!loading && isOffline && filteredClips.length === 0 && (
          <NetworkError
            message={t("clips.offline")}
            onRetry={() => void fetchClips()}
          />
        )}

        {!loading && !isOffline && error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300 flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{t("clips.error.title")}</span>
            </div>
            <button
              type="button"
              onClick={() => void fetchClips()}
              className="shrink-0 underline hover:text-white cursor-pointer"
            >
              {t("clips.error.retry")}
            </button>
          </div>
        )}

        {!loading && !isOffline && !error && filteredClips.length === 0 && (
          <div className="rounded-lg border border-border bg-surface-raised/40 p-6 text-center">
            <Film className="mx-auto mb-2 h-6 w-6 text-text-muted opacity-60" />
            <p className="text-xs font-semibold text-text-primary">
              {t("clips.empty.title")}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
              {t("clips.empty.description")}
            </p>
          </div>
        )}

        {!loading && !error && visibleClips.length > 0 && (
          <div
            style={{
              paddingTop: topSpacerPx,
              paddingBottom: bottomSpacerPx,
            }}
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {visibleClips.map((clip) => (
                <ClipTile
                  key={clip.id}
                  clip={clip}
                  isHovered={hoveredClipId === clip.id}
                  onHoverStart={handleHoverStart}
                  onHoverEnd={handleHoverEnd}
                  onAddToTimeline={handleAdd}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
