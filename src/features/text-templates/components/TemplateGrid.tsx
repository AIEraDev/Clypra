/**
 * TemplateGrid — per-category fetching component for text templates.
 *
 * Mirrors the EffectGrid pattern:
 *  - Each category tab triggers an independent API fetch
 *  - In-memory cache prevents duplicate requests on re-visit
 *  - Skeleton → grid → empty-state flow
 *  - Integrated search (filters the current category's items client-side)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, RefreshCw } from "lucide-react";
import { TemplateCard } from "@/components/ui/TemplateCard";
import { TemplateDefinition, TEMPLATE_CATEGORIES } from "../types";
import { TextEffectsApi } from "@/features/text-effects/api/textEffectsApi";
import { useFavoritesStore } from "@/store/favoritesStore";

// Pretty-print a category slug
const formatCategoryLabel = (cat: string) =>
  cat
    .replace(/-/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// Category-aware empty-state copy
const CATEGORY_EMPTY_STATE: Record<string, { headline: string; sub: string }> =
  {
    "lower-thirds": {
      headline: "No lower thirds yet",
      sub: "Broadcast-style name and title cards coming soon",
    },
    titles: {
      headline: "No title cards yet",
      sub: "Cinematic opening and closing titles coming soon",
    },
    callouts: {
      headline: "No callouts yet",
      sub: "Animated callouts and labels coming soon",
    },
    subtitles: {
      headline: "No subtitle templates yet",
      sub: "Styled captions and subtitle overlays coming soon",
    },
    countdowns: {
      headline: "No countdowns yet",
      sub: "Countdown timers and event announcements coming soon",
    },
    quotes: {
      headline: "No quote cards yet",
      sub: "Inspirational quote and pull-quote templates coming soon",
    },
    social: {
      headline: "No social overlays yet",
      sub: "Story frames, handle cards, and link badges coming soon",
    },
    sports: {
      headline: "No sports graphics yet",
      sub: "Scoreboards, stats, and player card overlays coming soon",
    },
    gaming: {
      headline: "No gaming overlays yet",
      sub: "HUD elements, kill feeds, and notification cards coming soon",
    },
    news: {
      headline: "No news tickers yet",
      sub: "Breaking-news crawls and headline straps coming soon",
    },
    minimal: {
      headline: "No minimal templates yet",
      sub: "Clean, typographic-led layouts coming soon",
    },
  };

function getCategoryEmptyState(cat: string) {
  return (
    CATEGORY_EMPTY_STATE[cat] ?? {
      headline: `No ${formatCategoryLabel(cat).toLowerCase()} templates yet`,
      sub: "Check back soon — new templates are added regularly",
    }
  );
}

interface TemplateGridProps {
  onPreview: (template: TemplateDefinition) => void;
  onApply: (template: TemplateDefinition, e: React.MouseEvent) => void;
}

// Module-level per-category cache — persists across component unmounts with 30m TTL
const categoryCache = new Map<string, TemplateDefinition[]>();
const categoryCacheTimestamps = new Map<string, number>();
const TEMPLATE_CATEGORY_TTL_MS = 30 * 60 * 1000; // 30 mins

export function clearTemplateGridCache(): void {
  categoryCache.clear();
  categoryCacheTimestamps.clear();
}

export function TemplateGrid({ onPreview, onApply }: TemplateGridProps) {
  const [activeCategory, setActiveCategory] = useState<string>(
    TEMPLATE_CATEGORIES[0],
  );
  const [items, setItems] = useState<TemplateDefinition[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { favorites, downloadedTemplates, downloadingIds, toggleFavorite } =
    useFavoritesStore();

  const fetchCategory = useCallback(async (category: string, force = false) => {
    const cached = categoryCache.get(category);
    const cachedAt = categoryCacheTimestamps.get(category);
    const isStale = !cachedAt || Date.now() - cachedAt > TEMPLATE_CATEGORY_TTL_MS;

    // Valid cache hit (non-empty and fresh)
    if (!force && cached && cached.length > 0 && !isStale) {
      setItems(cached);
      setLoading(false);
      setError(null);
      return;
    }

    // Abort previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const data = await TextEffectsApi.getTemplatesByCategory(category, { forceRefresh: force });
      if (controller.signal.aborted) return;
      categoryCache.set(category, data as TemplateDefinition[]);
      categoryCacheTimestamps.set(category, Date.now());
      setItems(data as TemplateDefinition[]);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error(
        `[TemplateGrid] Failed to load category "${category}":`,
        err,
      );
      setError("Failed to load templates. Tap to retry.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategory(activeCategory);
    setSearchQuery(""); // clear search on tab switch
  }, [activeCategory, fetchCategory]);

  // Periodic 30-minute background auto-refresh
  useEffect(() => {
    const timer = setInterval(() => {
      fetchCategory(activeCategory, true);
    }, TEMPLATE_CATEGORY_TTL_MS);
    return () => clearInterval(timer);
  }, [activeCategory, fetchCategory]);

  const handleCategoryChange = (cat: string) => {
    if (cat === activeCategory) return;
    setActiveCategory(cat);
  };

  const filteredItems = items.filter((t) => {
    const label = (t.displayName || t.name || t.label || "").toLowerCase();
    const desc = (t.description || "").toLowerCase();
    const tags = (t.tags || []).join(" ").toLowerCase();
    const q = searchQuery.toLowerCase();
    return label.includes(q) || desc.includes(q) || tags.includes(q);
  });

  return (
    <div className="flex flex-col h-full">
      {/* ── Category tabs ── */}
      <div className="shrink-0 border-b border-border/40 bg-surface/5">
        <div
          className="flex overflow-x-auto gap-0.5 p-1 whitespace-nowrap"
          style={{ scrollbarWidth: "none" }}
        >
          {TEMPLATE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => handleCategoryChange(cat)}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer hover:bg-accent/10 hover:text-accent ${
                activeCategory === cat
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted"
              }`}
            >
              {formatCategoryLabel(cat)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Search bar + Refresh ── */}
      <div className="shrink-0 px-2 py-1.5 border-b border-border/30 flex items-center gap-1.5">
        <div className="relative flex-1 flex items-center">
          <Search
            size={11}
            className="absolute left-2 text-text-muted/60 pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${formatCategoryLabel(activeCategory)}…`}
            className="w-full bg-surface-raised/40 border border-border/40 rounded-md pl-6 pr-6 py-1 text-[11px] text-text-primary placeholder:text-text-muted/50 outline-none focus:border-accent/40 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 text-text-muted/60 hover:text-text-primary transition-colors"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <button
          onClick={() => fetchCategory(activeCategory, true)}
          disabled={loading}
          title="Refresh templates from server"
          className="p-1.5 rounded-md bg-surface-raised/40 hover:bg-surface-raised border border-border/40 text-text-muted hover:text-accent transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        >
          <RefreshCw size={11} className={loading ? "animate-spin text-accent" : ""} />
        </button>
      </div>

      {/* ── Grid body ── */}
      <div className="flex-1 overflow-y-auto p-1 scrollbar-thin">
        {loading && <GridSkeleton />}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <p className="text-xs text-text-muted text-center">{error}</p>
            <button
              onClick={() => {
                categoryCache.delete(activeCategory);
                fetchCategory(activeCategory, true);
              }}
              className="flex items-center gap-1 text-xs text-accent underline cursor-pointer hover:text-accent-soft"
            >
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        )}

        {!loading && !error && filteredItems.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-1.5 text-xs text-text-muted">
            {searchQuery ? (
              <>
                <p>
                  No templates match &ldquo;{searchQuery}&rdquo; in{" "}
                  {formatCategoryLabel(activeCategory)}
                </p>
                <button
                  onClick={() => setSearchQuery("")}
                  className="opacity-60 hover:opacity-100 underline cursor-pointer transition-opacity"
                >
                  Clear search
                </button>
              </>
            ) : items.length === 0 ? (
              <>
                <p className="font-medium text-text-primary/80">
                  {getCategoryEmptyState(activeCategory).headline}
                </p>
                <p className="opacity-60 text-center px-4">
                  {getCategoryEmptyState(activeCategory).sub}
                </p>
                <button
                  onClick={() => fetchCategory(activeCategory, true)}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1 rounded-md bg-surface-raised border border-border/60 hover:border-accent/40 text-[11px] text-text-primary hover:text-accent transition-colors cursor-pointer"
                >
                  <RefreshCw size={11} /> Check for updates
                </button>
              </>
            ) : (
              <>
                <p>No templates found</p>
                <p className="opacity-60">Try a different search term</p>
              </>
            )}
          </div>
        )}

        {!loading && !error && filteredItems.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {filteredItems.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isFavorite={favorites.includes(template.id)}
                isDownloading={downloadingIds.includes(template.id)}
                isDownloaded={downloadedTemplates.includes(template.id)}
                onFavorite={(e) => {
                  e.stopPropagation();
                  toggleFavorite(template.id);
                }}
                onApply={(e) => onApply(template, e)}
                onPreview={() => onPreview(template)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl bg-white/5 animate-pulse aspect-square"
          style={{ animationDelay: `${i * 45}ms` }}
        />
      ))}
    </div>
  );
}
