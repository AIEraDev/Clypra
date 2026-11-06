/**
 * MediaAnimationSection — Animation browser for Video and Image clips.
 *
 * Mirrors MotionPresetSection but:
 * - Tabs: In / Out / Combo (no Loop)
 * - Fetches from /media-animations catalog (positionX/Y slide presets)
 * - Shows thumbnail images on preset cards when available
 * - On hover: plays previewUrl video from the start; on blur: pauses and
 *   reverts to the thumbnail image
 * - Each tab mounts its own CategoryGrid (keyed by tab) so each category's
 *   fetch, state, and render tree are fully isolated
 */

import React, { useState, useCallback, useMemo } from "react";
import { Ban, Search, X, Star } from "lucide-react";
import type { Clip } from "@/types";
import type { ClipMotionConfig } from "@/types/motion";
import { compileClipMotionKeyframes } from "@/core/animation/motionPresets";
import {
  useMediaAnimationCategory,
  useMediaAnimationCatalogSnapshot,
  type MediaAnimationCategory,
  downloadManifest,
  getMediaAnimationPreset,
} from "./mediaAnimationCatalog";
import { mediaAnimationCacheManager } from "./cache/mediaAnimationCache";
import type { MediaAnimationPreset } from "./cache/mediaAnimationCache";
import { useI18n } from "@/i18n";
import PresetCard from "./PresetCard";

interface MediaAnimationSectionProps {
  selectedClip: Clip;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  canvasWidth?: number;
  canvasHeight?: number;
}

const FAVORITES_KEY = "clypra_favorite_media_animation_presets";

const getStoredFavorites = (): Set<string> => {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
};

const saveStoredFavorites = (favs: Set<string>) => {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favs)));
  } catch {}
};

type CategoryFilter = "all" | "favorites";

// ── CategoryGrid ──────────────────────────────────────────────────────────────
// Isolated per-tab grid component. Keyed by `category` in the parent so each
// tab gets a completely independent React subtree — no shared hook state, no
// stale snapshot bleed between tabs.

interface CategoryGridProps {
  category: MediaAnimationCategory;
  activePresetId: string | undefined;
  searchQuery: string;
  activeFilter: CategoryFilter;
  favorites: Set<string>;
  downloadingIds: Set<string>;
  downloadedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onDownload: (id: string, e: React.MouseEvent) => void;
}

const CategoryGrid: React.FC<CategoryGridProps> = ({
  category,
  activePresetId,
  searchQuery,
  activeFilter,
  favorites,
  downloadingIds,
  downloadedIds,
  onSelect,
  onToggleFavorite,
  onDownload,
}) => {
  const { t } = useI18n();
  // Each CategoryGrid instance subscribes independently to its own category.
  // Because this component is keyed by category in the parent, switching tabs
  // unmounts the old grid and mounts a fresh one — no state leaks.
  const phaseData = useMediaAnimationCategory(category);

  const filteredPresets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return phaseData.presets.filter((preset) => {
      if (activeFilter === "favorites" && !favorites.has(preset.id))
        return false;
      if (q) {
        const matchesName = preset.name.toLowerCase().includes(q);
        const matchesDesc = preset.description.toLowerCase().includes(q);
        const matchesTags = preset.tags?.some((tag) =>
          tag.toLowerCase().includes(q),
        );
        if (!matchesName && !matchesDesc && !matchesTags) return false;
      }
      return true;
    });
  }, [phaseData.presets, activeFilter, searchQuery, favorites]);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2 max-h-80 overflow-y-auto pr-0.5 scrollbar-thin">
      {/* None card */}
      <button
        type="button"
        onClick={() => onSelect("none")}
        className="flex flex-col items-center group cursor-pointer text-left"
      >
        <div
          className={`w-full h-16 rounded-md flex flex-col items-center justify-center transition-all relative ${
            !activePresetId || activePresetId === "none"
              ? "bg-accent/10 text-gray-50"
              : "bg-accent/10 border border-accent/30 text-text-muted"
          }`}
        >
          <Ban className="w-5 h-5 opacity-80" />
        </div>
        <span
          title="None"
          className="text-[10px] font-medium text-text-muted mt-0.5 truncate max-w-full group-hover:text-text-primary"
        >
          {t("properties.animation.none")}
        </span>
      </button>

      {/* Combo empty state */}
      {category === "combo" &&
        filteredPresets.length === 0 &&
        phaseData.status !== "loading" && (
          <div className="col-span-4 flex items-center justify-center py-8 text-[11px] text-text-muted">
            {t("properties.mediaAnimation.comboComingSoon")}
          </div>
        )}

      {/* Empty state for in/out */}
      {category !== "combo" &&
        filteredPresets.length === 0 &&
        phaseData.status === "ready" && (
          <div className="col-span-4 flex items-center justify-center py-8 text-[11px] text-text-muted">
            {t("properties.animation.none")}
          </div>
        )}

      {/* Loading skeletons */}
      {phaseData.status === "loading" &&
        Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="w-full h-16 rounded-md bg-accent/10 animate-pulse" />
          </div>
        ))}

      {/* Preset cards */}
      {filteredPresets.map((preset) => {
        const mediaPreset = preset as MediaAnimationPreset;
        const isDownloaded =
          downloadedIds.has(preset.id) ||
          mediaAnimationCacheManager.isCached(
            preset.id,
            mediaPreset.revisionId ?? "",
          );
        return (
          <PresetCard
            key={preset.id}
            name={preset.name}
            icon={preset.icon}
            thumbnailUrl={mediaPreset.thumbnailUrl}
            previewUrl={mediaPreset.previewUrl}
            isSelected={activePresetId === preset.id}
            isFavorite={favorites.has(preset.id)}
            onSelect={() => onSelect(preset.id)}
            onToggleFavorite={(e) => onToggleFavorite(preset.id, e)}
            isDownloaded={isDownloaded}
            isDownloading={downloadingIds.has(preset.id)}
            onDownload={(e) => onDownload(preset.id, e)}
          />
        );
      })}
    </div>
  );
};

// ── MediaAnimationSection ─────────────────────────────────────────────────────

export const MediaAnimationSection: React.FC<MediaAnimationSectionProps> = ({
  selectedClip,
  handleUpdateMultiple,
  canvasWidth = 1920,
  canvasHeight = 1080,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<MediaAnimationCategory>("in");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>("all");
  const [favorites, setFavorites] = useState<Set<string>>(() =>
    getStoredFavorites(),
  );
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(() => {
    const keys = Array.from(mediaAnimationCacheManager.manifests.keys()).map(
      (k) => k.split("@")[0],
    );
    return new Set(keys);
  });

  React.useEffect(() => {
    return mediaAnimationCacheManager.onHydrated(() => {
      setDownloadedIds((prev) => {
        const keys = Array.from(
          mediaAnimationCacheManager.manifests.keys(),
        ).map((k) => k.split("@")[0]);
        return new Set([...prev, ...keys]);
      });
    });
  }, []);

  const catalogSnapshot = useMediaAnimationCatalogSnapshot();

  const toggleFavorite = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveStoredFavorites(next);
      return next;
    });
  }, []);

  const handleDownload = useCallback(
    async (presetId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (downloadingIds.has(presetId)) return;
      const preset = getMediaAnimationPreset(presetId);
      const version = preset?.revisionId;
      if (!version) return;
      setDownloadingIds((prev) => new Set(prev).add(presetId));
      try {
        await downloadManifest(presetId, version);
        setDownloadedIds((prev) => new Set(prev).add(presetId));
      } catch (err) {
        console.error("[MediaAnimationSection] Download failed:", err);
      } finally {
        setDownloadingIds((prev) => {
          const next = new Set(prev);
          next.delete(presetId);
          return next;
        });
      }
    },
    [downloadingIds],
  );

  const motion: ClipMotionConfig = selectedClip.motion ?? {};
  const hasIn = Boolean(motion.inPreset && motion.inPreset !== "none");
  const hasOut = Boolean(motion.outPreset && motion.outPreset !== "none");

  const updateMotion = useCallback(
    (updates: Partial<ClipMotionConfig>) => {
      const nextMotion: ClipMotionConfig = { ...motion, ...updates };
      const mergedCatalog = catalogSnapshot.presets.map((p) => {
        const merged = getMediaAnimationPreset(p.id);
        return merged ?? p;
      });
      const compiledKeyframes = compileClipMotionKeyframes(
        selectedClip,
        nextMotion,
        canvasWidth,
        canvasHeight,
        mergedCatalog,
      );
      handleUpdateMultiple({
        motion: nextMotion,
        visualKeyframes: compiledKeyframes,
      });
    },
    [
      motion,
      selectedClip,
      canvasWidth,
      canvasHeight,
      handleUpdateMultiple,
      catalogSnapshot.presets,
    ],
  );

  const activePresetId =
    activeTab === "in"
      ? motion.inPreset
      : activeTab === "out"
        ? motion.outPreset
        : motion.inPreset;

  const handleSelectPreset = useCallback(
    (id: string) => {
      if (id === "none") {
        if (activeTab === "in" || activeTab === "combo")
          updateMotion({ inPreset: "none" });
        else updateMotion({ outPreset: "none" });
        return;
      }
      if (activeTab === "in") updateMotion({ inPreset: id });
      else if (activeTab === "out") updateMotion({ outPreset: id });
      else updateMotion({ inPreset: id });
    },
    [activeTab, updateMotion],
  );

  return (
    <div className="space-y-1.5 select-none text-white relative p-2">
      {/* ── Tabs ── */}
      <div className="bg-panel p-0.5 rounded-sm flex gap-1 border border-white/5">
        {(["in", "out", "combo"] as MediaAnimationCategory[]).map((tab) => {
          const isActive = activeTab === tab;
          const hasDot = tab === "in" ? hasIn : tab === "out" ? hasOut : false;
          const dotColor =
            tab === "in"
              ? "bg-[#00E5FF]"
              : tab === "out"
                ? "bg-amber-400"
                : "bg-purple-400";
          const label =
            tab === "in"
              ? t("properties.animation.inDetailed")
              : tab === "out"
                ? t("properties.animation.outDetailed")
                : t("properties.mediaAnimation.combo");
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-0.5 text-xs rounded-sm transition-all text-center capitalize flex items-center justify-center gap-1 cursor-pointer ${
                isActive
                  ? "bg-[#38383e] text-white shadow-sm font-semibold"
                  : "text-[#8e8e93] hover:text-white"
              }`}
            >
              {hasDot && (
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
              )}
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Search ── */}
      <div className="relative flex items-center bg-[#18181A] rounded-lg border border-border/40 px-2.5 py-1 focus-within:border-[#00E5FF]/60 focus-within:ring-1 focus-within:ring-[#00E5FF]/30 transition-all">
        <Search className="w-3.5 h-3.5 text-text-muted shrink-0 mr-2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("properties.animation.searchPlaceholder")}
          className="bg-transparent text-[11px] text-text-primary placeholder:text-text-muted/60 outline-none w-full"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="text-text-muted hover:text-text-primary p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* ── Per-tab isolated grid — keyed by activeTab so each tab mounts
           a completely independent CategoryGrid instance with its own
           useMediaAnimationCategory hook and fetch lifecycle. ── */}
      <CategoryGrid
        key={activeTab}
        category={activeTab}
        activePresetId={activePresetId}
        searchQuery={searchQuery}
        activeFilter={activeFilter}
        favorites={favorites}
        downloadingIds={downloadingIds}
        downloadedIds={downloadedIds}
        onSelect={handleSelectPreset}
        onToggleFavorite={toggleFavorite}
        onDownload={handleDownload}
      />
    </div>
  );
};

export default MediaAnimationSection;
