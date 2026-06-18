import React, { useMemo, useState, useEffect } from "react";
import { Filter, Grid3X3, Plus, Search, SlidersHorizontal, Sparkles, Sun, Palette, Droplets, Camera, AlertCircle, CheckCircle, Download, Loader2, Star, type LucideIcon } from "lucide-react";
import type { TabProps } from "./types";
import { useProjectStore } from "@/store/projectStore";
import { FiltersApi } from "@/features/filters/api/filtersApi";
import { filterCacheManager } from "@/features/filters/cache/filterCache";
import type { FilterAsset } from "@/features/filters/types";
import { useFavoritesStore } from "@/store/favoritesStore";

type FilterCategory = string;

const FILTER_ICONS: Record<string, LucideIcon> = {
  "filter-sepia": Sun,
  "filter-retro": Camera,
  "filter-aged": Grid3X3,
  "filter-crisp": Sparkles,
  "filter-vivid": Palette,
  "filter-cool": Droplets,
  "filter-cinematic-teal": SlidersHorizontal,
  "filter-bleach": Sun,
  "filter-moody": Camera,
  "filter-bw-classic": Grid3X3,
  "filter-high-contrast": SlidersHorizontal,
  "filter-soft-bw": Droplets,
  "filter-warm": Sun,
  "filter-cool-blue": Droplets,
  "filter-purple-haze": Sparkles,
};

const DEFAULT_ICON = Filter;

const FILTER_CATEGORIES = [
  { id: "essentials", name: "Essentials" },
  { id: "cinematic", name: "Cinematic" },
  { id: "vintage", name: "Vintage" },
  { id: "vibrant", name: "Vibrant" },
  { id: "mono", name: "Mono" },
  { id: "aesthetic", name: "Aesthetic" },
];

export const FiltersTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<FilterCategory>("essentials");
  const [filters, setFilters] = useState<FilterAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { favorites, toggleFavorite } = useFavoritesStore();

  // Initialize cache on mount
  useEffect(() => {
    filterCacheManager.initialize();
  }, []);

  // Fetch filters when category changes
  useEffect(() => {
    const fetchFilters = async () => {
      if (!activeCategory) return;
      setLoading(true);
      setError(null);

      try {
        const data = await FiltersApi.getByCategory(activeCategory);
        setFilters(data);
      } catch (err) {
        console.error(`[FiltersTab] Failed to load category ${activeCategory}:`, err);
        setError(err instanceof Error ? err.message : "Failed to load filters");
      } finally {
        setLoading(false);
      }
    };

    fetchFilters();
  }, [activeCategory]);

  // Get filters for the active category only
  const filteredFilters = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return filters.filter((filter) => {
      const matchesSearch = !query || filter.name.toLowerCase().includes(query) || filter.description.toLowerCase().includes(query) || filter.category.includes(query);
      return matchesSearch;
    });
  }, [filters, searchQuery]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface/5 select-none">
      <div className="flex items-center gap-2.5 p-1 border-b border-border/50 shrink-0 bg-surface/10">
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-sm bg-accent/10 border border-accent/20 text-accent-soft">
          <Filter className="w-3.5 h-3.5" />
          <span className="text-[12px] font-semibold">Filters</span>
        </div>
        <div className="w-px h-5 bg-border/80 shrink-0" />
        <div className="grow overflow-x-auto flex items-center gap-2 pb-0.5 whitespace-nowrap" style={{ scrollbarWidth: "none" }}>
          {FILTER_CATEGORIES.map((category) => (
            <button key={category.id} onClick={() => setActiveCategory(category.id)} className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer shrink-0 ${activeCategory === category.id ? "bg-accent text-white shadow-sm" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/60"}`}>
              {category.name}
            </button>
          ))}
        </div>
      </div>

      <div className="p-1 border-b border-border/50 bg-surface/5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" placeholder="Search filters..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-raised/70 border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      <div className="grow overflow-y-auto scrollbar-thin p-1" style={{ scrollbarWidth: "none" }}>
        {error && (
          <div className="mb-3 p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-red-200 flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Failed to load filters</p>
              <p className="opacity-80 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {loading && filteredFilters.length === 0 ? (
          <div className="grid grid-cols-3 gap-1.5">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : filteredFilters.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center text-text-muted gap-1 text-xs">
            <Filter className="w-5 h-5" />
            <p>No matching filters found</p>
            <p className="opacity-60">Try another category or search</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {filteredFilters.map((filter) => (
              <FilterCard
                key={filter.id}
                filter={filter}
                isFavorite={favorites.includes(filter.id)}
                onFavorite={(e) => {
                  e.stopPropagation();
                  toggleFavorite(filter.id);
                }}
                onAddToTimeline={() => onAddToTimeline?.(filter as any, "filters")}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const SkeletonCard = () => (
  <div className="animate-pulse rounded-xl border border-border/30 bg-surface-raised/40 aspect-square" />
);

interface FilterCardProps {
  filter: FilterAsset;
  isFavorite: boolean;
  onFavorite: (e: React.MouseEvent) => void;
  onAddToTimeline: (e: React.MouseEvent) => void;
}

const FilterCard: React.FC<FilterCardProps> = ({
  filter,
  isFavorite,
  onFavorite,
  onAddToTimeline,
}) => {
  const Icon = FILTER_ICONS[filter.id] || DEFAULT_ICON;
  const isReady = true; // All filters are ready (status field is just for UI labeling)
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Check if filter is cached on mount
  useEffect(() => {
    filterCacheManager.initialize().then(() => {
      const cached = filterCacheManager.isCached(filter.id);
      setIsDownloaded(cached);
    });
  }, [filter.id]);

  // Use filter-specific preview, or fallback to sample image for testing
  const previewSrc = filter.thumbnail || "/filter-previews/sample.jpg";

  // Apply CSS filter approximation based on filter ID for preview
  const getCSSFilterStyle = (filterId: string): React.CSSProperties => {
    const filterMap: Record<string, string> = {
      "filter-sepia": "sepia(0.8) hue-rotate(-10deg) saturate(1.2)",
      "filter-retro": "sepia(0.4) contrast(1.2) saturate(0.8) hue-rotate(10deg)",
      "filter-aged": "sepia(0.6) contrast(1.1) brightness(0.95) saturate(0.7)",
      "filter-crisp": "contrast(1.3) saturate(1.2) brightness(1.05)",
      "filter-vivid": "saturate(1.8) contrast(1.1) brightness(1.05)",
      "filter-cool": "hue-rotate(-20deg) saturate(1.2) brightness(1.05)",
      "filter-cinematic-teal": "sepia(0.3) hue-rotate(150deg) saturate(1.4)",
      "filter-bleach": "contrast(1.2) brightness(1.1) saturate(0.6)",
      "filter-moody": "contrast(1.3) brightness(0.85) saturate(0.9) hue-rotate(-10deg)",
      "filter-bw-classic": "grayscale(1) contrast(1.2)",
      "filter-high-contrast": "grayscale(1) contrast(1.6) brightness(1.05)",
      "filter-soft-bw": "grayscale(1) contrast(0.9) brightness(1.05)",
      "filter-warm": "sepia(0.3) saturate(1.3) hue-rotate(10deg) brightness(1.05)",
      "filter-cool-blue": "hue-rotate(180deg) saturate(1.2) brightness(1.05)",
      "filter-purple-haze": "hue-rotate(260deg) saturate(1.3) brightness(0.95)",
    };

    const filterValue = filterMap[filterId] || "";
    return filterValue ? { filter: filterValue } : {};
  };

  // Handle add to timeline (download first, then add)
  const handleAddToTimeline = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering preview/click
    if (isDownloading) return;

    try {
      console.log(`[FilterCard] Adding filter "${filter.name}" to timeline`);
      setIsDownloading(true);

      // Download filter JSON with minimum delay for visual feedback
      const downloadPromise = filterCacheManager.ensureDownloaded(filter);
      const delayPromise = new Promise((resolve) => setTimeout(resolve, 300));

      await Promise.all([downloadPromise, delayPromise]);
      console.log(`[FilterCard] Filter "${filter.name}" downloaded successfully`);
      setIsDownloaded(true);

      // Add to timeline
      onAddToTimeline(e);
      console.log(`[FilterCard] Filter "${filter.name}" added to timeline`);

      // Show success feedback
      useProjectStore.getState().showToast(`Added ${filter.name} filter`);
    } catch (error) {
      console.error("[FilterCard] Add to timeline failed:", error);
      useProjectStore.getState().showToast("Failed to add filter", "error");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      onClick={handleAddToTimeline}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="w-full aspect-square bg-surface-raised/40 hover:bg-surface-raised/80 border border-border/40 hover:border-accent/40 rounded-xl relative overflow-hidden flex flex-col justify-between p-1 transition-all duration-300 group cursor-pointer shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
    >
      {/* Downloading Overlay */}
      {isDownloading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-20 pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
            <span className="text-[10px] font-semibold text-accent">Downloading...</span>
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

      {/* Preview Area / Image or Fallback Gradient */}
      <div className="flex-1 flex items-center justify-center w-full select-none relative overflow-hidden rounded-lg bg-surface">
        {previewSrc ? (
          <img
            src={previewSrc}
            alt={`${filter.name} preview`}
            className="w-full h-full object-cover rounded-lg"
            style={getCSSFilterStyle(filter.id)}
            loading="lazy"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = "none";
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full w-full bg-linear-to-br from-accent/10 to-accent/0 text-center rounded-lg p-2">
            <Icon className="w-6 h-6 text-text-muted group-hover:scale-[1.05] transition-transform duration-300" />
          </div>
        )}
      </div>

      {/* Footer Info / Apply Button */}
      <div className="flex items-center justify-between w-full mt-0.5 z-10 px-0.5">
        <span className="text-[9px] text-text-muted font-medium group-hover:text-text-primary transition-colors truncate max-w-[65px]" title={filter.name}>
          {filter.name}
        </span>
        <button
          onClick={handleAddToTimeline}
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
};
